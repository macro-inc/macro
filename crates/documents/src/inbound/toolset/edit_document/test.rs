use super::*;

use std::sync::{Arc, Mutex};

use crate::domain::events::InteractionReason;
use crate::domain::models::{
    CommentThread, CreateDocumentRepoArgs, CreateTaskRequest, DocumentError,
    DocumentTeamShareResponse, EditDocumentServiceArgs, GithubPullRequestsResponse,
    LocationQueryParams, TaskBranchName,
};
use crate::domain::ports::editing::{EditResult, EditingWorkerService};
use crate::domain::response::{
    CreateDocumentResponseData, DocumentResponse, GetDocumentResponseData, LocationResponseV3,
};
use entity_access::domain::models::{
    AccessError, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt, EntityPermission,
    MemberTeamRole, OwnerAccessLevel, RequiredPermission, TeamRole, UserTeamInfo, ViewAccessLevel,
};
use lexical_client::LexicalClient;
use macro_sync_service_jwt::DocumentPermissionToken;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use model::{document::DocumentBasic, sync_service::SyncServiceVersionID};
use model_entity::Entity;
use sync_service_client::SyncServiceClient;
use uuid::Uuid;

const TEST_USER_ID: &str = "macro|editor@example.com";
const TEST_DOCUMENT_ID: &str = "019fd3b9-3c6c-7c05-89c2-a27f0121813b";

struct FakeDocumentService {
    file_type: Option<String>,
    content: DocumentContent,
}

impl FakeDocumentService {
    fn new(file_type: &str, content: DocumentContent) -> Self {
        Self {
            file_type: Some(file_type.to_string()),
            content,
        }
    }
}

impl DocumentService for FakeDocumentService {
    async fn internal_get_basic_document(
        &self,
        document_id: &str,
    ) -> Result<DocumentBasic, DocumentError> {
        Ok(DocumentBasic {
            document_id: document_id.to_string(),
            document_name: "Test code file".to_string(),
            owner: MacroUserIdStr::try_from(TEST_USER_ID.to_string())
                .expect("test user id should be valid"),
            file_type: self.file_type.clone(),
            sub_type: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            project_id: None,
            deleted_at: None,
        })
    }

    async fn get_document_content(
        &self,
        _document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        Ok(self.content.clone())
    }

    async fn get_document_by_team_slug(
        &self,
        _team_receipt: EntityAccessReceipt<MemberTeamRole>,
        _slug: &str,
    ) -> Result<String, DocumentError> {
        panic!("unexpected get_document_by_team_slug call")
    }

    async fn get_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetDocumentResponseData, DocumentError> {
        panic!("unexpected get_document call")
    }

    async fn get_document_location(
        &self,
        _document_context: &DocumentBasic,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        _params: LocationQueryParams,
    ) -> Result<LocationResponseV3, DocumentError> {
        panic!("unexpected get_document_location call")
    }

    async fn delete_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _project_id: Option<String>,
    ) -> Result<(), DocumentError> {
        panic!("unexpected delete_document call")
    }

    async fn get_document_text(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        panic!("unexpected get_document_text call")
    }

    async fn get_document_comments(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<CommentThread>, DocumentError> {
        panic!("unexpected get_document_comments call")
    }

    async fn create_document(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        panic!("unexpected create_document call")
    }

    async fn get_short_id(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        panic!("unexpected get_short_id call")
    }

    async fn get_task_branch_name(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        _document_name: String,
    ) -> Result<TaskBranchName, DocumentError> {
        panic!("unexpected get_task_branch_name call")
    }

    async fn get_task_github_pull_requests(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        _document_context: &DocumentBasic,
    ) -> Result<GithubPullRequestsResponse, DocumentError> {
        panic!("unexpected get_task_github_pull_requests call")
    }

    async fn edit_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        _document_context: DocumentBasic,
        _args: EditDocumentServiceArgs,
    ) -> Result<(), DocumentError> {
        panic!("unexpected edit_document call")
    }

    async fn update_task_status(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        _status: &str,
    ) -> Result<(), DocumentError> {
        panic!("unexpected update_task_status call")
    }

    async fn copy_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
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

    async fn upload_snapshot(&self, _document_id: &str, _bytes: Vec<u8>) -> anyhow::Result<()> {
        panic!("unexpected upload_snapshot call")
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
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DocumentTeamShareResponse, DocumentError> {
        panic!("unexpected get_team_share call")
    }

    async fn set_team_share(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        _share: bool,
    ) -> Result<DocumentTeamShareResponse, DocumentError> {
        panic!("unexpected set_team_share call")
    }
}

impl DocumentCreationService for FakeDocumentService {
    async fn create_document(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        panic!("unexpected create_document call")
    }

    async fn handle_task_properties(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _document_id: &str,
        _request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        panic!("unexpected handle_task_properties call")
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

#[derive(Clone, Default)]
struct FakeEntityAccessService;

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
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
        panic!("unexpected get_user_team call")
    }
}

#[derive(Clone, Default)]
struct FakeEditingWorker {
    edit_calls: Arc<Mutex<Vec<String>>>,
}

impl EditingWorkerService for FakeEditingWorker {
    async fn edit(
        &self,
        document_id: &str,
        _document_token: &DocumentPermissionToken,
        _instructions: &str,
    ) -> anyhow::Result<EditResult> {
        self.edit_calls
            .lock()
            .expect("edit calls lock poisoned")
            .push(document_id.to_string());

        Ok(EditResult {
            edits_applied: 1,
            usage: Vec::new(),
            clarification: None,
        })
    }

    async fn delete_traces(&self, _document_id: &str) -> anyhow::Result<()> {
        panic!("unexpected delete_traces call")
    }
}

type TestToolContext =
    DocumentToolContext<FakeDocumentService, FakeEntityAccessService, FakeEditingWorker>;

fn tool_context(
    service: FakeDocumentService,
    editing: FakeEditingWorker,
) -> ServiceContext<TestToolContext> {
    ServiceContext(DocumentToolContext::new(
        service,
        FakeEntityAccessService,
        LexicalClient::new(
            "unused-internal-key".to_string(),
            "http://localhost/lexical".to_string(),
        ),
        SyncServiceClient::new(
            "unused-internal-key".to_string(),
            "http://localhost/sync".to_string(),
        ),
        editing,
        "unused-jwt-secret".to_string(),
    ))
}

fn request_context() -> RequestContext {
    RequestContext::new(
        MacroUserIdStr::try_from(TEST_USER_ID.to_string()).expect("test user id should be valid"),
    )
}

async fn call_edit_document(
    content: DocumentContent,
    file_type: &str,
) -> (ToolResult<EditDocumentResponse>, FakeEditingWorker) {
    let editing = FakeEditingWorker::default();
    let tool = EditDocument {
        document_id: TEST_DOCUMENT_ID.to_string(),
        instructions: "tidy up the imports".to_string(),
    };

    let result = tool
        .call(
            tool_context(
                FakeDocumentService::new(file_type, content),
                editing.clone(),
            ),
            request_context(),
        )
        .await;

    (result, editing)
}

#[tokio::test]
async fn rejects_object_storage_document_without_calling_the_worker() {
    let (result, editing) = call_edit_document(
        DocumentContent::ready(DocumentContentLocation::ObjectStorage),
        "py",
    )
    .await;

    let error = result.expect_err("object-storage document should be rejected");
    assert!(
        error.description.contains("object_storage"),
        "description should name the content location: {}",
        error.description
    );
    assert!(
        error.description.contains("cannot be edited"),
        "description should state the constraint: {}",
        error.description
    );
    assert!(
        editing
            .edit_calls
            .lock()
            .expect("edit calls lock poisoned")
            .is_empty(),
        "the editing worker must not be called for a rejected document"
    );
}

#[tokio::test]
async fn allows_sync_service_backed_document() {
    let (result, editing) = call_edit_document(
        DocumentContent::ready(DocumentContentLocation::SyncService),
        "md",
    )
    .await;

    let response = result.expect("sync-service document should be editable");
    assert_eq!(response.summary, "Applied 1 edit(s) to the document.");
    assert_eq!(
        *editing.edit_calls.lock().expect("edit calls lock poisoned"),
        vec![TEST_DOCUMENT_ID.to_string()]
    );
}

#[test]
fn only_sync_service_content_is_editable() {
    assert!(
        ensure_sync_service_backed(&DocumentContent::ready(
            DocumentContentLocation::SyncService
        ))
        .is_ok()
    );

    for location in [
        DocumentContentLocation::ObjectStorage,
        DocumentContentLocation::ConvertedPdf,
        DocumentContentLocation::DocxBomParts,
        DocumentContentLocation::Unknown,
    ] {
        assert!(
            ensure_sync_service_backed(&DocumentContent::ready(location)).is_err(),
            "{location:?} has no Loro doc and must be rejected"
        );
    }

    assert!(
        ensure_sync_service_backed(&DocumentContent::pending()).is_err(),
        "content with no known location must be rejected"
    );
}
