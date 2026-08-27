use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, request::Builder},
};
use embedding::embedding_provider::openai::TextEmbedding3Small;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, MemberTeamRole, RequiredPermission, TeamRole, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use http_body_util::BodyExt;
use lexical_client::LexicalClient;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use model::{
    document::{DocumentBasic, DocumentMetadata, FileType, response::DocumentResponseMetadata},
    sync_service::SyncServiceVersionID,
};
use model_entity::Entity;
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use sync_service_client::SyncServiceClient;
use task_dedup::{
    JudgeResult, PgTaskDedupService,
    domain::ports::{TaskDedupNotifier, TaskDuplicateJudge},
    outbound::{
        cohere::CohereReranker,
        postgres::{PgTaskMatchRepo, PgTaskVectorDb},
    },
};
use tower::ServiceExt;
use uuid::Uuid;

use super::{DocumentRouterState, content_uploaded::content_uploaded_handler, documents_router};
use crate::{
    domain::{
        content::DocumentContent,
        create::DocumentCreator,
        events::InteractionReason,
        models::{
            CommentThread, CreateDocumentRepoArgs, CreateTaskRequest, DocumentError,
            DocumentTeamShareResponse, EditDocumentServiceArgs, GithubPullRequestsResponse,
            ImportEmailAttachmentRepoArgs, LocationQueryParams, TaskBranchName,
        },
        ports::{DocumentContentEventService, DocumentService, create::DocumentCreationService},
        response::{
            CreateDocumentResponseData, DocumentMetadataWithContent, DocumentResponse,
            DocumentResponseMetadataWithContent, GetDocumentResponseData, LocationResponseV3,
        },
    },
    outbound::{
        document_bytes_upload::ReqwestDocumentBytesUploader,
        markdown_init::LexicalSyncMarkdownInitializer,
    },
};

const JWT_TOKEN: &str = "valid-jwt";
const JWT_USER_ID: &str = "macro|jwt-user@example.com";
const STANDARD_INTERNAL_KEY: &str = "standard-internal-key";
const STANDARD_INTERNAL_USER_ID: &str = "macro|standard-internal@example.com";
const LEGACY_INTERNAL_KEY: &str = "legacy-internal-key";
const LEGACY_INTERNAL_USER_ID: &str = "macro|legacy-internal@example.com";
const LEGACY_INTERNAL_API_KEY_HEADER: &str = "x-document-storage-service-auth-key";
const LEGACY_INTERNAL_USER_ID_HEADER: &str = "x-document-storage-service-user-id";
const TEST_ORGANIZATION_ID: i32 = 42;
const TEAM_ID: Uuid = Uuid::from_u128(0x82c6f359_691f_4ff3_965a_016a2970b1a2);
const RESOLVED_DOCUMENT_ID: &str = "resolved-document";

#[derive(Clone, Debug, Eq, PartialEq)]
struct CreateDocumentCall {
    user_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ImportEmailAttachmentCall {
    user_id: String,
    email_attachment_id: Uuid,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct UploadSnapshotCall {
    document_id: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContentUploadedCall {
    document_id: String,
    file_type: FileType,
    document_version_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TeamSlugCall {
    team_id: String,
    user_id: String,
    slug: String,
}

#[derive(Clone, Debug)]
enum TeamSlugResult {
    Success(String),
    BadRequest(String),
    NotFound(String),
}

#[derive(Default)]
struct FakeDocumentService {
    create_calls: Mutex<Vec<CreateDocumentCall>>,
    import_calls: Mutex<Vec<ImportEmailAttachmentCall>>,
    upload_snapshot_calls: Mutex<Vec<UploadSnapshotCall>>,
    content_uploaded_calls: Mutex<Vec<ContentUploadedCall>>,
    internal_get_calls: Mutex<Vec<String>>,
    team_slug_calls: Mutex<Vec<TeamSlugCall>>,
    team_slug_result: Mutex<Option<TeamSlugResult>>,
    get_document_calls: Mutex<Vec<String>>,
}

impl FakeDocumentService {
    fn create_calls(&self) -> Vec<CreateDocumentCall> {
        self.create_calls
            .lock()
            .expect("create calls lock poisoned")
            .clone()
    }

    fn import_calls(&self) -> Vec<ImportEmailAttachmentCall> {
        self.import_calls
            .lock()
            .expect("import calls lock poisoned")
            .clone()
    }

    fn upload_snapshot_calls(&self) -> Vec<UploadSnapshotCall> {
        self.upload_snapshot_calls
            .lock()
            .expect("upload snapshot calls lock poisoned")
            .clone()
    }

    fn content_uploaded_calls(&self) -> Vec<ContentUploadedCall> {
        self.content_uploaded_calls
            .lock()
            .expect("content uploaded calls lock poisoned")
            .clone()
    }

    fn set_team_slug_result(&self, result: TeamSlugResult) {
        *self
            .team_slug_result
            .lock()
            .expect("team slug result lock poisoned") = Some(result);
    }

    fn internal_get_calls(&self) -> Vec<String> {
        self.internal_get_calls
            .lock()
            .expect("internal get calls lock poisoned")
            .clone()
    }

    fn team_slug_calls(&self) -> Vec<TeamSlugCall> {
        self.team_slug_calls
            .lock()
            .expect("team slug calls lock poisoned")
            .clone()
    }

    fn get_document_calls(&self) -> Vec<String> {
        self.get_document_calls
            .lock()
            .expect("get document calls lock poisoned")
            .clone()
    }
}

impl DocumentService for FakeDocumentService {
    async fn internal_get_basic_document(
        &self,
        document_id: &str,
    ) -> Result<DocumentBasic, DocumentError> {
        self.internal_get_calls
            .lock()
            .expect("internal get calls lock poisoned")
            .push(document_id.to_string());

        Ok(DocumentBasic {
            document_id: document_id.to_string(),
            document_name: "test document".to_string(),
            owner: MacroUserIdStr::try_from(JWT_USER_ID.to_string())
                .expect("test user id should be valid"),
            file_type: Some("pdf".to_string()),
            sub_type: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            project_id: None,
            deleted_at: None,
        })
    }

    async fn get_document_by_team_slug(
        &self,
        team_receipt: EntityAccessReceipt<MemberTeamRole>,
        slug: &str,
    ) -> Result<String, DocumentError> {
        self.team_slug_calls
            .lock()
            .expect("team slug calls lock poisoned")
            .push(TeamSlugCall {
                team_id: team_receipt.entity().entity_id.clone(),
                user_id: team_receipt
                    .get_authenticated_user()
                    .expect("team receipt should have an authenticated user")
                    .as_ref()
                    .to_string(),
                slug: slug.to_string(),
            });

        match self
            .team_slug_result
            .lock()
            .expect("team slug result lock poisoned")
            .clone()
            .expect("team slug result should be configured")
        {
            TeamSlugResult::Success(document_id) => Ok(document_id),
            TeamSlugResult::BadRequest(message) => Err(DocumentError::BadRequest(message)),
            TeamSlugResult::NotFound(message) => Err(DocumentError::NotFound(message)),
        }
    }

    async fn get_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<GetDocumentResponseData, DocumentError> {
        let document_id = entity_access_receipt.entity().entity_id.clone();
        self.get_document_calls
            .lock()
            .expect("get document calls lock poisoned")
            .push(document_id.clone());

        Ok(get_document_response(&document_id))
    }

    async fn get_document_location(
        &self,
        _document_context: &DocumentBasic,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
        _params: LocationQueryParams,
    ) -> Result<LocationResponseV3, DocumentError> {
        panic!("unexpected get_document_location call")
    }

    async fn delete_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<
            entity_access::domain::models::OwnerAccessLevel,
        >,
        _project_id: Option<String>,
    ) -> Result<(), DocumentError> {
        panic!("unexpected delete_document call")
    }

    async fn get_document_text(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        panic!("unexpected get_document_text call")
    }

    async fn get_document_comments(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<Vec<CommentThread>, DocumentError> {
        panic!("unexpected get_document_comments call")
    }

    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        _args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        self.create_calls
            .lock()
            .expect("create calls lock poisoned")
            .push(CreateDocumentCall {
                user_id: user_id.as_ref().to_string(),
            });

        Ok(create_document_response(user_id))
    }

    async fn import_email_attachment(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: ImportEmailAttachmentRepoArgs,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        self.import_calls
            .lock()
            .expect("import calls lock poisoned")
            .push(ImportEmailAttachmentCall {
                user_id: user_id.as_ref().to_string(),
                email_attachment_id: args.email_attachment_id,
            });

        Ok(create_document_response(user_id))
    }

    async fn get_document_content(
        &self,
        _document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        panic!("unexpected get_document_content call")
    }

    async fn get_short_id(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        panic!("unexpected get_short_id call")
    }

    async fn get_task_branch_name(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
        _document_name: String,
    ) -> Result<TaskBranchName, DocumentError> {
        panic!("unexpected get_task_branch_name call")
    }

    async fn get_task_github_pull_requests(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
        _document_context: &DocumentBasic,
    ) -> Result<GithubPullRequestsResponse, DocumentError> {
        panic!("unexpected get_task_github_pull_requests call")
    }

    async fn edit_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _document_context: DocumentBasic,
        _args: EditDocumentServiceArgs,
    ) -> Result<(), DocumentError> {
        panic!("unexpected edit_document call")
    }

    async fn update_task_status(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _status: &str,
    ) -> Result<(), DocumentError> {
        panic!("unexpected update_task_status call")
    }

    async fn copy_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
        _document_context: DocumentBasic,
        _user_id: MacroUserIdStr<'static>,
        _document_name: String,
        _query_version_id: Option<i64>,
        _sync_version_id: Option<SyncServiceVersionID>,
    ) -> Result<DocumentResponse, DocumentError> {
        panic!("unexpected copy_document call")
    }

    async fn get_project_name(&self, _project_id: &str) -> Result<String, DocumentError> {
        panic!("unexpected get_project_name call")
    }

    async fn get_project_children(
        &self,
        _project_id: &str,
    ) -> Result<Vec<Entity<'static>>, DocumentError> {
        panic!("unexpected get_project_children call")
    }

    async fn handle_task_properties(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _document_id: &str,
        _request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        panic!("unexpected handle_task_properties call")
    }

    async fn get_snapshot(&self, _document_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        panic!("unexpected get_snapshot call")
    }

    async fn upload_snapshot(&self, document_id: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.upload_snapshot_calls
            .lock()
            .expect("upload snapshot calls lock poisoned")
            .push(UploadSnapshotCall {
                document_id: document_id.to_string(),
                bytes,
            });
        Ok(())
    }

    async fn record_interaction(
        &self,
        _document_id: &str,
        _reason: InteractionReason,
    ) -> anyhow::Result<()> {
        panic!("unexpected record_interaction call")
    }

    async fn get_team_share(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<DocumentTeamShareResponse, DocumentError> {
        panic!("unexpected get_team_share call")
    }

    async fn set_team_share(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _share: bool,
    ) -> Result<DocumentTeamShareResponse, DocumentError> {
        panic!("unexpected set_team_share call")
    }
}

impl DocumentContentEventService for FakeDocumentService {
    async fn publish_content_uploaded(
        &self,
        document_id: &str,
        file_type: FileType,
        document_version_id: Option<String>,
    ) -> Result<(), DocumentError> {
        self.content_uploaded_calls
            .lock()
            .expect("content uploaded calls lock poisoned")
            .push(ContentUploadedCall {
                document_id: document_id.to_string(),
                file_type,
                document_version_id,
            });
        Ok(())
    }
}

impl DocumentCreationService for FakeDocumentService {
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        DocumentService::create_document(self, user_id, args, job_id).await
    }

    async fn handle_task_properties(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _document_id: &str,
        _request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        panic!("unexpected creation handle_task_properties call")
    }

    async fn mark_document_uploaded(&self, _document_id: &str) -> Result<(), DocumentError> {
        panic!("unexpected mark_document_uploaded call")
    }

    async fn set_document_content(
        &self,
        _document_id: &str,
        _content: DocumentContent,
    ) -> Result<(), DocumentError> {
        panic!("unexpected set_document_content call")
    }

    async fn cleanup_created_document(&self, _document_id: &str) {
        panic!("unexpected cleanup_created_document call")
    }
}

fn create_document_response(user_id: MacroUserIdStr<'static>) -> CreateDocumentResponseData {
    CreateDocumentResponseData {
        document_response: DocumentResponse {
            document_metadata: DocumentResponseMetadataWithContent::new(
                DocumentResponseMetadata {
                    document_id: "created-document".to_string(),
                    document_version_id: 1,
                    owner: user_id,
                    document_name: "test document".to_string(),
                    file_type: Some("pdf".to_string()),
                    sha: Some("test-sha".to_string()),
                    branched_from_id: None,
                    branched_from_version_id: None,
                    document_family_id: None,
                    document_bom: None,
                    modification_data: None,
                    created_at: None,
                    updated_at: None,
                    sub_type: None,
                },
                DocumentContent::pending(),
            ),
            presigned_url: None,
        },
        content_type: "application/pdf".to_string(),
        file_type: Some("pdf".to_string()),
    }
}

fn get_document_response(document_id: &str) -> GetDocumentResponseData {
    GetDocumentResponseData {
        document_metadata: DocumentMetadataWithContent::new(
            DocumentMetadata {
                document_id: document_id.to_string(),
                document_version_id: 1,
                owner: MacroUserIdStr::try_from(JWT_USER_ID.to_string())
                    .expect("test user id should be valid"),
                document_name: "resolved document".to_string(),
                file_type: Some("pdf".to_string()),
                sha: Some("test-sha".to_string()),
                project_id: None,
                project_name: None,
                branched_from_id: None,
                branched_from_version_id: None,
                document_family_id: None,
                document_bom: None,
                modification_data: None,
                created_at: None,
                updated_at: None,
                deleted_at: None,
                sub_type: None,
            },
            DocumentContent::pending(),
        ),
        user_access_level: AccessLevel::View,
        view_location: None,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DocumentAccessCall {
    user_id: String,
    organization_id: Option<i64>,
    entity_id: String,
    entity_type: EntityType,
}

#[derive(Clone)]
struct FakeEntityAccessService {
    team_info: Arc<Mutex<Option<UserTeamInfo>>>,
    deny_document_access: Arc<Mutex<bool>>,
    document_access_calls: Arc<Mutex<Vec<DocumentAccessCall>>>,
}

impl Default for FakeEntityAccessService {
    fn default() -> Self {
        Self {
            team_info: Arc::new(Mutex::new(None)),
            deny_document_access: Arc::new(Mutex::new(false)),
            document_access_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl FakeEntityAccessService {
    fn set_team(&self, team_info: Option<UserTeamInfo>) {
        *self.team_info.lock().expect("team info lock poisoned") = team_info;
    }

    fn deny_document_access(&self) {
        *self
            .deny_document_access
            .lock()
            .expect("document access result lock poisoned") = true;
    }

    fn document_access_calls(&self) -> Vec<DocumentAccessCall> {
        self.document_access_calls
            .lock()
            .expect("document access calls lock poisoned")
            .clone()
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.document_access_calls
            .lock()
            .expect("document access calls lock poisoned")
            .push(DocumentAccessCall {
                user_id: user_id.as_ref().to_string(),
                organization_id: user_org_id,
                entity_id: entity_id.to_string(),
                entity_type,
            });

        if *self
            .deny_document_access
            .lock()
            .expect("document access result lock poisoned")
        {
            return Err(AccessError::Unauthorized);
        }

        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::try_from(user_id.as_ref().to_string())
                .expect("test user id should be valid"),
            entity_access::domain::models::Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_bot_entity_access_receipt call")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        panic!("unexpected get_access_level call")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(*self.team_info.lock().expect("team info lock poisoned"))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum AuthorizationCall {
    Jwt(String),
    Internal {
        provided_key: String,
        claims: InternalIdentityClaims,
    },
}

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    calls: Arc<Mutex<Vec<AuthorizationCall>>>,
}

impl FakeAuthorizationService {
    fn calls(&self) -> Vec<AuthorizationCall> {
        self.calls.lock().expect("auth calls lock poisoned").clone()
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("auth calls lock poisoned")
            .push(AuthorizationCall::Jwt(jwt.to_string()));

        if jwt != JWT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(user_context(JWT_USER_ID))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("auth calls lock poisoned")
            .push(AuthorizationCall::Internal {
                provided_key: provided_key.to_string(),
                claims: claims.clone(),
            });

        if !matches!(provided_key, STANDARD_INTERNAL_KEY | LEGACY_INTERNAL_KEY) {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.as_deref().map(user_context))
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "test-fusion-user".to_string(),
        permissions: None,
        organization_id: Some(TEST_ORGANIZATION_ID),
    }
}

struct FakeTaskDuplicateJudge;

#[async_trait]
impl TaskDuplicateJudge for FakeTaskDuplicateJudge {
    async fn judge(&self, _left: &str, _right: &str) -> JudgeResult {
        panic!("unexpected task duplicate judge call")
    }
}

struct FakeTaskDedupNotifier;

#[async_trait]
impl TaskDedupNotifier for FakeTaskDedupNotifier {
    async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
        panic!("unexpected task dedup notifier call")
    }
}

fn test_router() -> (
    Router,
    Arc<FakeDocumentService>,
    FakeEntityAccessService,
    FakeAuthorizationService,
) {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/documents-router-test")
        .expect("test database URL should be valid");
    let document_service = Arc::new(FakeDocumentService::default());
    let authorization_service = FakeAuthorizationService::default();
    let access_service = FakeEntityAccessService::default();
    let lexical_client = Arc::new(LexicalClient::new(
        "unused-internal-key".to_string(),
        "http://localhost/lexical".to_string(),
    ));
    let task_dedup_service = Arc::new(PgTaskDedupService::new(
        TextEmbedding3Small::new("unused-openai-key"),
        PgTaskVectorDb::new(pool.clone()),
        CohereReranker::new("unused-cohere-key"),
        Arc::new(FakeTaskDuplicateJudge),
        Arc::new(FakeTaskDedupNotifier),
        Arc::new(PgTaskMatchRepo::new(pool.clone())),
    ));
    let creator = DocumentCreator::new(
        document_service.clone(),
        LexicalSyncMarkdownInitializer::new(
            lexical_client.as_ref().clone(),
            SyncServiceClient::new(
                "unused-internal-key".to_string(),
                "http://localhost/sync".to_string(),
            ),
        ),
        ReqwestDocumentBytesUploader::default(),
    );
    let state = DocumentRouterState {
        service: document_service.clone(),
        access_service: Arc::new(access_service.clone()),
        authorization_state: MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
        pool,
        task_dedup_service,
        lexical_client,
        creator,
        document_permission_jwt_secret: "unused-jwt-secret".to_string(),
    };
    let router = documents_router::<
        FakeDocumentService,
        FakeEntityAccessService,
        FakeAuthorizationService,
        DocumentRouterState<FakeDocumentService, FakeEntityAccessService, FakeAuthorizationService>,
    >(state.clone())
    .route(
        "/{document_id}/content-uploaded",
        axum::routing::post(
            content_uploaded_handler::<
                FakeDocumentService,
                FakeEntityAccessService,
                FakeAuthorizationService,
            >,
        ),
    )
    .with_state(state);

    (
        router,
        document_service,
        access_service,
        authorization_service,
    )
}

fn create_request() -> Builder {
    Request::post("/").header("content-type", "application/json")
}

fn request_body(email_attachment_id: Option<Uuid>) -> Body {
    Body::from(
        serde_json::to_vec(&json!({
            "sha": "test-sha",
            "documentName": "test document.pdf",
            "fileType": "pdf",
            "emailAttachmentId": email_attachment_id,
        }))
        .expect("request should serialize"),
    )
}

fn finish_request(builder: Builder, email_attachment_id: Option<Uuid>) -> Request<Body> {
    builder
        .body(request_body(email_attachment_id))
        .expect("request should build")
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("response body should collect")
        .to_bytes();
    let body = serde_json::from_slice(&bytes).expect("response should contain JSON");

    (status, body)
}

async fn send_status(router: &Router, request: Request<Body>) -> StatusCode {
    router.clone().oneshot(request).await.unwrap().status()
}

fn team_slug_request(slug: &str) -> Builder {
    Request::get(format!("/slug/{slug}"))
}

fn team_member() -> UserTeamInfo {
    UserTeamInfo {
        team_id: TEAM_ID,
        role: TeamRole::Member,
    }
}

#[tokio::test]
async fn get_document_by_team_slug_succeeds_without_document_id_middleware() {
    let (router, document_service, access_service, _authorization_service) = test_router();
    access_service.set_team(Some(team_member()));
    document_service
        .set_team_slug_result(TeamSlugResult::Success(RESOLVED_DOCUMENT_ID.to_string()));
    let request = team_slug_request("ENG-42")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .body(Body::empty())
        .expect("request should build");

    assert_eq!(send_status(&router, request).await, StatusCode::OK);
    assert_eq!(
        document_service.team_slug_calls(),
        [TeamSlugCall {
            team_id: TEAM_ID.to_string(),
            user_id: JWT_USER_ID.to_string(),
            slug: "ENG-42".to_string(),
        }]
    );
    assert_eq!(
        access_service.document_access_calls(),
        [DocumentAccessCall {
            user_id: JWT_USER_ID.to_string(),
            organization_id: Some(i64::from(TEST_ORGANIZATION_ID)),
            entity_id: RESOLVED_DOCUMENT_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
    assert_eq!(
        document_service.get_document_calls(),
        [RESOLVED_DOCUMENT_ID.to_string()]
    );
    assert!(document_service.internal_get_calls().is_empty());
}

#[tokio::test]
async fn get_document_by_team_slug_requires_credentials_and_team_membership() {
    let (router, document_service, _access_service, _authorization_service) = test_router();
    let missing_credentials = team_slug_request("ENG-42")
        .body(Body::empty())
        .expect("request should build");

    assert_eq!(
        send_status(&router, missing_credentials).await,
        StatusCode::UNAUTHORIZED
    );
    assert!(document_service.team_slug_calls().is_empty());
    assert!(document_service.internal_get_calls().is_empty());

    let (router, document_service, _access_service, _authorization_service) = test_router();
    let missing_team = team_slug_request("ENG-42")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .body(Body::empty())
        .expect("request should build");

    assert_eq!(
        send_status(&router, missing_team).await,
        StatusCode::UNAUTHORIZED
    );
    assert!(document_service.team_slug_calls().is_empty());
    assert!(document_service.internal_get_calls().is_empty());
}

#[tokio::test]
async fn get_document_by_team_slug_preserves_document_access_denial() {
    let (router, document_service, access_service, _authorization_service) = test_router();
    access_service.set_team(Some(team_member()));
    access_service.deny_document_access();
    document_service
        .set_team_slug_result(TeamSlugResult::Success(RESOLVED_DOCUMENT_ID.to_string()));
    let request = team_slug_request("ENG-42")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .body(Body::empty())
        .expect("request should build");

    assert_eq!(
        send_status(&router, request).await,
        StatusCode::UNAUTHORIZED
    );
    assert!(document_service.get_document_calls().is_empty());
    assert!(document_service.internal_get_calls().is_empty());
}

#[tokio::test]
async fn get_document_by_team_slug_preserves_domain_error_statuses() {
    let (router, document_service, access_service, _authorization_service) = test_router();
    access_service.set_team(Some(team_member()));
    document_service.set_team_slug_result(TeamSlugResult::BadRequest(
        "invalid team-task slug".to_string(),
    ));
    let malformed_request = team_slug_request("invalid")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .body(Body::empty())
        .expect("request should build");

    assert_eq!(
        send_status(&router, malformed_request).await,
        StatusCode::BAD_REQUEST
    );

    document_service.set_team_slug_result(TeamSlugResult::NotFound("ENG-999".to_string()));
    let missing_request = team_slug_request("ENG-999")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .body(Body::empty())
        .expect("request should build");

    assert_eq!(
        send_status(&router, missing_request).await,
        StatusCode::NOT_FOUND
    );
    assert!(access_service.document_access_calls().is_empty());
    assert!(document_service.get_document_calls().is_empty());
    assert!(document_service.internal_get_calls().is_empty());
}

#[tokio::test]
async fn content_uploaded_requires_internal_authentication_and_forwards_request() {
    let (router, document_service, _access_service, authorization_service) = test_router();
    let body = || {
        Body::from(
            serde_json::to_vec(&json!({
                "file_type": "pdf",
                "document_version_id": "convert",
            }))
            .expect("request should serialize"),
        )
    };

    let jwt_request = Request::post("/content-document/content-uploaded")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .header("content-type", "application/json")
        .body(body())
        .expect("request should build");
    assert_eq!(
        send_status(&router, jwt_request).await,
        StatusCode::FORBIDDEN
    );
    assert!(document_service.content_uploaded_calls().is_empty());

    let internal_request = Request::post("/content-document/content-uploaded")
        .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
        .header("content-type", "application/json")
        .body(body())
        .expect("request should build");
    assert_eq!(send_status(&router, internal_request).await, StatusCode::OK);
    assert_eq!(
        document_service.content_uploaded_calls(),
        [ContentUploadedCall {
            document_id: "content-document".to_string(),
            file_type: FileType::Pdf,
            document_version_id: Some("convert".to_string()),
        }]
    );
    assert_eq!(
        authorization_service.calls(),
        [
            AuthorizationCall::Jwt(JWT_TOKEN.to_string()),
            AuthorizationCall::Internal {
                provided_key: STANDARD_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
        ]
    );
}

#[tokio::test]
async fn snapshot_upload_requires_internal_api_key() {
    let snapshot = b"snapshot bytes";
    let (router, document_service, _access_service, authorization_service) = test_router();

    let jwt_request = Request::put("/snapshot-document/snapshot")
        .header("authorization", format!("Bearer {JWT_TOKEN}"))
        .body(Body::from(snapshot.as_slice()))
        .expect("request should build");
    assert_eq!(
        send_status(&router, jwt_request).await,
        StatusCode::FORBIDDEN
    );
    assert!(document_service.upload_snapshot_calls().is_empty());
    assert_eq!(
        authorization_service.calls(),
        [AuthorizationCall::Jwt(JWT_TOKEN.to_string())]
    );

    let internal_request = Request::put("/snapshot-document/snapshot")
        .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
        .body(Body::from(snapshot.as_slice()))
        .expect("request should build");
    assert_eq!(send_status(&router, internal_request).await, StatusCode::OK);
    assert_eq!(
        document_service.upload_snapshot_calls(),
        [UploadSnapshotCall {
            document_id: "snapshot-document".to_string(),
            bytes: snapshot.to_vec(),
        }]
    );
    assert_eq!(
        authorization_service.calls(),
        [
            AuthorizationCall::Jwt(JWT_TOKEN.to_string()),
            AuthorizationCall::Internal {
                provided_key: STANDARD_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            }
        ]
    );
}

#[tokio::test]
async fn legacy_internal_headers_reach_the_internal_only_creation_path() {
    let email_attachment_id = Uuid::new_v4();
    let (router, document_service, _access_service, authorization_service) = test_router();
    let request = finish_request(
        create_request()
            .header(LEGACY_INTERNAL_API_KEY_HEADER, LEGACY_INTERNAL_KEY)
            .header(LEGACY_INTERNAL_USER_ID_HEADER, LEGACY_INTERNAL_USER_ID),
        Some(email_attachment_id),
    );

    let (status, _body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert!(document_service.create_calls().is_empty());
    assert_eq!(
        document_service.import_calls(),
        [ImportEmailAttachmentCall {
            user_id: LEGACY_INTERNAL_USER_ID.to_string(),
            email_attachment_id,
        }]
    );
    assert!(!authorization_service.calls().is_empty());
    assert!(authorization_service.calls().iter().all(|call| matches!(
        call,
        AuthorizationCall::Internal { provided_key, .. }
            if provided_key == LEGACY_INTERNAL_KEY
    )));
}

#[tokio::test]
async fn standard_internal_headers_reach_the_document_service() {
    let (router, document_service, _access_service, authorization_service) = test_router();
    let request = finish_request(
        create_request()
            .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID),
        None,
    );

    let (status, _body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        document_service.create_calls(),
        [CreateDocumentCall {
            user_id: STANDARD_INTERNAL_USER_ID.to_string(),
        }]
    );
    assert!(document_service.import_calls().is_empty());
    assert!(!authorization_service.calls().is_empty());
    assert!(authorization_service.calls().iter().all(|call| matches!(
        call,
        AuthorizationCall::Internal { provided_key, .. }
            if provided_key == STANDARD_INTERNAL_KEY
    )));
}

#[tokio::test]
async fn standard_internal_headers_take_precedence_over_legacy_headers() {
    let (router, document_service, _access_service, authorization_service) = test_router();
    let request = finish_request(
        create_request()
            .header(INTERNAL_API_KEY_HEADER, STANDARD_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(LEGACY_INTERNAL_API_KEY_HEADER, LEGACY_INTERNAL_KEY)
            .header(LEGACY_INTERNAL_USER_ID_HEADER, LEGACY_INTERNAL_USER_ID),
        None,
    );

    let (status, _body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        document_service.create_calls(),
        [CreateDocumentCall {
            user_id: STANDARD_INTERNAL_USER_ID.to_string(),
        }]
    );
    assert!(document_service.import_calls().is_empty());
    assert!(!authorization_service.calls().is_empty());
    assert!(authorization_service.calls().iter().all(|call| matches!(
        call,
        AuthorizationCall::Internal {
            provided_key,
            claims: InternalIdentityClaims {
                user_id: Some(user_id),
                ..
            },
        } if provided_key == STANDARD_INTERNAL_KEY && user_id == STANDARD_INTERNAL_USER_ID
    )));
}

#[tokio::test]
async fn jwt_user_cannot_create_a_document_for_an_email_attachment() {
    let email_attachment_id = Uuid::new_v4();
    let (router, document_service, _access_service, _authorization_service) = test_router();
    let request = finish_request(
        create_request().header("authorization", format!("Bearer {JWT_TOKEN}")),
        Some(email_attachment_id),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert!(document_service.create_calls().is_empty());
    assert!(document_service.import_calls().is_empty());
}
