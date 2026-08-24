use entity_access::domain::models::MemberTeamRole;
use foreign_entity::domain::models::{
    CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
};
use foreign_entity::domain::ports::{ForeignEntityListQuery, ForeignEntityService};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::cowlike::CowLike;
use model::document::{DocumentMetadata, FileType};
use std::sync::{Arc, Mutex};

use crate::domain::models::{
    EmailImportRepoOutcome, GithubPullRequest, ImportEmailAttachmentRepoArgs,
};
use crate::domain::ports::{DocumentContentEventService, MockDocumentRepo};

use super::*;

fn make_test_metadata() -> DocumentMetadata {
    DocumentMetadata {
        document_id: "doc-1".to_string(),
        document_version_id: 1,
        owner: macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        document_name: "test_doc".to_string(),
        file_type: Some("txt".to_string()),
        sha: Some("sha-1".to_string()),
        project_id: Some("project-1".to_string()),
        project_name: Some("Test Project".to_string()),
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        document_bom: None,
        modification_data: None,
        created_at: None,
        updated_at: None,
        deleted_at: None,
        sub_type: None,
    }
}

fn make_mock_repo() -> MockDocumentRepo {
    MockDocumentRepo::new()
}

fn test_cloudfront_config() -> CloudFrontConfig {
    CloudFrontConfig {
        distribution_url: "https://cdn.example.test".to_string(),
        signer_public_key_id: "test-key-id".to_string(),
        signer_private_key: "test-private-key".to_string(),
        presigned_url_expiry_seconds: 60,
        browser_cache_expiry_seconds: 60,
    }
}

fn task_document_context(document_id: &str) -> DocumentBasic {
    DocumentBasic {
        document_id: document_id.to_string(),
        document_name: "Test task".to_string(),
        owner: macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|owner@user.com")
            .unwrap()
            .into_owned(),
        file_type: Some("md".to_string()),
        sub_type: Some(DocumentSubType::Task),
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

fn authenticated_receipt(document_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
        .unwrap()
        .into_owned();

    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user_id,
        document_id,
        EntityType::Document,
    )
}

fn internal_receipt(document_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(document_id, EntityType::Document)
}

fn member_team_receipt(team_id: &str, user_id: &str) -> EntityAccessReceipt<MemberTeamRole> {
    let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str(user_id)
        .unwrap()
        .into_owned();

    EntityAccessReceipt::dangerously_assert_authenticated_user(user_id, team_id, EntityType::Team)
}

fn bot_id() -> entity_access::domain::models::BotId {
    entity_access::domain::models::BotId::new_from_uuid(uuid::uuid!(
        "00000000-0000-0000-0000-000000000123"
    ))
}

fn bot_receipt_scope() -> entity_access::domain::models::BotReceiptScope {
    entity_access::domain::models::BotReceiptScope::Team {
        team_id: uuid::uuid!("00000000-0000-0000-0000-000000000456"),
    }
}

fn bot_receipt(document_id: &str) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_bot(
        bot_id().into_storage_id(),
        bot_receipt_scope(),
        document_id,
        EntityType::Document,
    )
}

struct TestUploadUrlPort;

impl PresignedUploadUrlPort for TestUploadUrlPort {
    async fn put_document_storage_presigned_url(
        &self,
        _key: &str,
        _sha: &str,
        _content_type: ContentType,
    ) -> anyhow::Result<String> {
        Ok(String::new())
    }

    async fn put_docx_upload_presigned_url(
        &self,
        _key: &str,
        _sha: &str,
        _content_type: ContentType,
    ) -> anyhow::Result<String> {
        Ok(String::new())
    }

    async fn copy_object(&self, _source_key: &str, _destination_key: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn get_snapshot(&self, _document_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        Ok(None)
    }

    async fn upload_snapshot(&self, _document_id: &str, _bytes: Vec<u8>) -> anyhow::Result<()> {
        Ok(())
    }
}

struct TestTaskPropertiesPort;

impl TaskPropertiesPort for TestTaskPropertiesPort {
    async fn attach_task_properties(&self, _entity_ids: Vec<String>) -> anyhow::Result<()> {
        Ok(())
    }

    async fn update_task_status(&self, _entity_id: &str, _status: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn set_entity_property(
        &self,
        _user_id: &str,
        _entity_id: &str,
        _property_definition_id: uuid::Uuid,
        _value: Option<models_properties::api::requests::SetPropertyValue>,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    async fn copy_task_properties(
        &self,
        _from_task_id: &str,
        _to_task_id: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

struct TestConnectionService;

impl ConnectionService for TestConnectionService {
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        _invalidation_event: InvalidationEvent<'a, T>,
    ) -> Result<(), connection::domain::models::ConnectionError> {
        Ok(())
    }

    async fn send_channel_message<'a>(
        &self,
        _users: &[macro_user_id::user_id::MacroUserIdStr<'a>],
        _message_type: &str,
        _message: serde_json::Value,
    ) -> Result<(), connection::domain::models::ConnectionError> {
        Ok(())
    }
}

#[derive(Clone, Default)]
struct TestEntityAccessManagementService {
    added_to_projects: Arc<Mutex<Vec<uuid::Uuid>>>,
    removed_from_projects: Arc<Mutex<Vec<uuid::Uuid>>>,
}

impl EntityAccessManagementService for TestEntityAccessManagementService {
    async fn add_entity_to_project(
        &self,
        _entity_id: &uuid::Uuid,
        _entity_type: EntityType,
        project_id: &uuid::Uuid,
    ) -> Result<(), entity_access_management::domain::models::EntityAccessManagementError> {
        self.added_to_projects.lock().unwrap().push(*project_id);
        Ok(())
    }

    async fn remove_entity_from_project(
        &self,
        _entity_id: &uuid::Uuid,
        _entity_type: EntityType,
        old_project_id: &uuid::Uuid,
    ) -> Result<(), entity_access_management::domain::models::EntityAccessManagementError> {
        self.removed_from_projects
            .lock()
            .unwrap()
            .push(*old_project_id);
        Ok(())
    }

    async fn move_project(
        &self,
        _project_id: &uuid::Uuid,
        _old_project_id: Option<&uuid::Uuid>,
        _new_project_id: Option<&uuid::Uuid>,
    ) -> Result<(), entity_access_management::domain::models::EntityAccessManagementError> {
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ForeignEntityLookupRequest {
    foreign_entity_id: String,
    foreign_entity_source: Option<String>,
}

#[derive(Clone, Default)]
struct TestForeignEntityService {
    foreign_entities: Arc<Vec<ForeignEntity>>,
    lookup_requests: Arc<Mutex<Vec<ForeignEntityLookupRequest>>>,
}

impl TestForeignEntityService {
    fn new(foreign_entities: Vec<ForeignEntity>) -> Self {
        Self {
            foreign_entities: Arc::new(foreign_entities),
            lookup_requests: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn lookup_requests(&self) -> Arc<Mutex<Vec<ForeignEntityLookupRequest>>> {
        Arc::clone(&self.lookup_requests)
    }
}

impl ForeignEntityService for TestForeignEntityService {
    async fn get_foreign_entity(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("test service only supports foreign entity lookups by external ID")
    }

    async fn get_foreign_entity_by_id(
        &self,
        _id: uuid::Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("test service only supports foreign entity lookups by external ID")
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        self.lookup_requests
            .lock()
            .unwrap()
            .push(ForeignEntityLookupRequest {
                foreign_entity_id: foreign_entity_id.to_string(),
                foreign_entity_source: foreign_entity_source.map(str::to_string),
            });

        Ok(self
            .foreign_entities
            .iter()
            .filter(|foreign_entity| {
                foreign_entity.foreign_entity_id == foreign_entity_id
                    && foreign_entity_source
                        .is_none_or(|source| foreign_entity.foreign_entity_source == source)
            })
            .cloned()
            .collect())
    }

    async fn get_foreign_entities_for_user(
        &self,
        _requesting_user: Option<String>,
        _source_ids: Vec<SourceId>,
        _limit: u32,
        _query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        unreachable!("test service only supports foreign entity lookups by external ID")
    }

    async fn create_foreign_entity(
        &self,
        _create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("test service only supports foreign entity lookups by external ID")
    }

    async fn delete_foreign_entity(&self, _id: uuid::Uuid) -> Result<(), ForeignEntityError> {
        unreachable!("test service only supports foreign entity lookups by external ID")
    }

    async fn patch_foreign_entity(
        &self,
        _id: uuid::Uuid,
        _patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("test service only supports foreign entity lookups by external ID")
    }
}

/// A document lifecycle event recorded by [`TestEventBroker`].
#[derive(Clone, Debug)]
struct PublishedEvent {
    topic: &'static str,
    key: String,
    payload: serde_json::Value,
}

#[derive(Clone, Default)]
struct TestEventBroker {
    published: Arc<Mutex<Vec<PublishedEvent>>>,
    fail_send: bool,
}

impl TestEventBroker {
    fn failing() -> Self {
        Self {
            fail_send: true,
            ..Self::default()
        }
    }

    fn published(&self) -> Arc<Mutex<Vec<PublishedEvent>>> {
        Arc::clone(&self.published)
    }
}

impl MacroEventBroker for TestEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        if self.fail_send {
            return Err(EventBrokerError::Publish("test broker failure".to_string()));
        }

        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic(),
            key: event.key().to_string(),
            payload: serde_json::to_value(event.event())?,
        });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

type TestDocumentService = DocumentServiceImpl<
    MockDocumentRepo,
    TestUploadUrlPort,
    TestTaskPropertiesPort,
    TestConnectionService,
    TestEntityAccessManagementService,
    TestForeignEntityService,
    TestEventBroker,
>;

fn make_test_service(repo: MockDocumentRepo) -> TestDocumentService {
    make_test_service_with_foreign_entities(repo, Vec::new())
}

fn make_test_service_with_foreign_entities(
    repo: MockDocumentRepo,
    foreign_entities: Vec<ForeignEntity>,
) -> TestDocumentService {
    make_test_service_with_foreign_entity_service(
        repo,
        TestForeignEntityService::new(foreign_entities),
    )
}

fn make_test_service_with_foreign_entity_service(
    repo: MockDocumentRepo,
    foreign_entity_service: TestForeignEntityService,
) -> TestDocumentService {
    DocumentServiceImpl::new(
        repo,
        test_cloudfront_config(),
        sync_service_client::SyncServiceClient::new(
            "test-sync-key".to_string(),
            "http://sync-service.test".to_string(),
        ),
        TestUploadUrlPort,
        TestTaskPropertiesPort,
        TestConnectionService,
        TestEntityAccessManagementService::default(),
        foreign_entity_service,
        TestEventBroker::default(),
    )
}

/// Build a test service along with a handle to its recording entity access service.
fn make_test_service_with_entity_access(
    repo: MockDocumentRepo,
) -> (TestDocumentService, TestEntityAccessManagementService) {
    let entity_access = TestEntityAccessManagementService::default();
    let service = DocumentServiceImpl::new(
        repo,
        test_cloudfront_config(),
        sync_service_client::SyncServiceClient::new(
            "test-sync-key".to_string(),
            "http://sync-service.test".to_string(),
        ),
        TestUploadUrlPort,
        TestTaskPropertiesPort,
        TestConnectionService,
        entity_access.clone(),
        TestForeignEntityService::default(),
        TestEventBroker::default(),
    );
    (service, entity_access)
}

/// Build a test service along with a handle to its recording event broker.
fn make_test_service_with_event_broker(
    repo: MockDocumentRepo,
) -> (TestDocumentService, TestEventBroker) {
    make_test_service_with_configured_event_broker(repo, TestEventBroker::default())
}

fn make_test_service_with_configured_event_broker(
    repo: MockDocumentRepo,
    event_broker: TestEventBroker,
) -> (TestDocumentService, TestEventBroker) {
    let service = DocumentServiceImpl::new(
        repo,
        test_cloudfront_config(),
        sync_service_client::SyncServiceClient::new(
            "test-sync-key".to_string(),
            "http://sync-service.test".to_string(),
        ),
        TestUploadUrlPort,
        TestTaskPropertiesPort,
        TestConnectionService,
        TestEntityAccessManagementService::default(),
        TestForeignEntityService::default(),
        event_broker.clone(),
    );
    (service, event_broker)
}

fn make_foreign_entity(
    id: uuid::Uuid,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
    stored_for_id: &str,
    stored_for_auth_entity: &str,
) -> ForeignEntity {
    let timestamp = chrono::Utc::now();

    ForeignEntity {
        id,
        foreign_entity_id: foreign_entity_id.to_string(),
        foreign_entity_source: foreign_entity_source.to_string(),
        metadata: serde_json::json!({}),
        stored_for_id: stored_for_id.to_string(),
        stored_for_auth_entity: stored_for_auth_entity.to_string(),
        created_at: timestamp,
        updated_at: timestamp,
    }
}

fn make_foreign_entity_with_metadata(
    id: uuid::Uuid,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
    stored_for_id: &str,
    stored_for_auth_entity: &str,
    metadata: serde_json::Value,
) -> ForeignEntity {
    let mut foreign_entity = make_foreign_entity(
        id,
        foreign_entity_id,
        foreign_entity_source,
        stored_for_id,
        stored_for_auth_entity,
    );
    foreign_entity.metadata = metadata;
    foreign_entity
}

fn expect_authenticated_team_lookup(repo: &mut MockDocumentRepo, team_ids: Vec<uuid::Uuid>) {
    repo.expect_get_team_ids_for_user()
        .withf(|user_id| user_id == "macro|user@user.com")
        .return_once(move |_| Box::pin(std::future::ready(Ok(team_ids))));
}

fn assert_pull_request_ref(
    pull_request: &GithubPullRequest,
    github_key: &str,
    owner: &str,
    repo: &str,
    number: u64,
) {
    let expected_url = format!("https://github.com/{owner}/{repo}/pull/{number}");
    let expected_display_name = format!("{owner}/{repo}#{number}");

    assert_eq!(pull_request.github_key.as_str(), github_key);
    assert_eq!(pull_request.owner.as_str(), owner);
    assert_eq!(pull_request.repo.as_str(), repo);
    assert_eq!(pull_request.number, number);
    assert_eq!(pull_request.url.as_str(), expected_url.as_str());
    assert_eq!(
        pull_request.display_name.as_str(),
        expected_display_name.as_str()
    );
}

fn assert_no_enriched_pull_request_metadata(pull_request: &GithubPullRequest) {
    assert!(pull_request.name.is_none());
    assert!(pull_request.status.is_none());
    assert!(pull_request.additions.is_none());
    assert!(pull_request.deletions.is_none());
    assert!(pull_request.comments.is_none());
    assert!(pull_request.checks.is_none());

    let pull_request_json = serde_json::to_value(pull_request).unwrap();
    assert!(pull_request_json.get("name").is_none());
    assert!(pull_request_json.get("status").is_none());
    assert!(pull_request_json.get("additions").is_none());
    assert!(pull_request_json.get("deletions").is_none());
    assert!(pull_request_json.get("comments").is_none());
    assert!(pull_request_json.get("checks").is_none());
}

fn assert_raw_pull_request(
    pull_request: &GithubPullRequest,
    github_key: &str,
    owner: &str,
    repo: &str,
    number: u64,
) {
    assert_pull_request_ref(pull_request, github_key, owner, repo, number);
    assert!(pull_request.foreign_entity_id.is_none());
    assert_no_enriched_pull_request_metadata(pull_request);

    let pull_request_json = serde_json::to_value(pull_request).unwrap();
    assert!(pull_request_json.get("foreignEntityId").is_none());
}

fn assert_shallow_pull_request_with_foreign_entity_id(
    pull_request: &GithubPullRequest,
    github_key: &str,
    owner: &str,
    repo: &str,
    number: u64,
    foreign_entity_id: uuid::Uuid,
) {
    assert_pull_request_ref(pull_request, github_key, owner, repo, number);
    assert_eq!(pull_request.foreign_entity_id, Some(foreign_entity_id));
    assert_no_enriched_pull_request_metadata(pull_request);

    let pull_request_json = serde_json::to_value(pull_request).unwrap();
    let expected_foreign_entity_id = serde_json::json!(foreign_entity_id.to_string());
    assert_eq!(
        pull_request_json.get("foreignEntityId"),
        Some(&expected_foreign_entity_id)
    );
}

#[tokio::test]
async fn get_document_by_team_slug_resolves_valid_slug() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000701");
    let mut repo = make_mock_repo();

    repo.expect_get_document_id_by_team_task_number()
        .withf(move |actual_team_id, task_num| actual_team_id == &team_id && *task_num == 42)
        .return_once(|_, _| Box::pin(std::future::ready(Ok(Some("doc-1".to_string())))));
    repo.expect_get_basic_document()
        .withf(|document_id| document_id == "doc-1")
        .return_once(|_| Box::pin(std::future::ready(Ok(task_document_context("doc-1")))));

    let document_id = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt(&team_id.to_string(), "macro|user@user.com"),
            "engineering-platform-42",
        )
        .await
        .unwrap();

    assert_eq!(document_id, "doc-1");
}

#[tokio::test]
async fn get_document_by_team_slug_rejects_malformed_slugs() {
    for slug in [
        "",
        "engineering",
        "-1",
        "engineering-",
        "engineering--task-1",
        "engineering-task",
        "engineering-1.5",
        "engineering-+1",
    ] {
        let mut repo = make_mock_repo();
        repo.expect_get_document_id_by_team_task_number().times(0);
        repo.expect_get_basic_document().times(0);

        let result = make_test_service(repo)
            .get_document_by_team_slug(
                member_team_receipt(
                    "00000000-0000-0000-0000-000000000701",
                    "macro|user@user.com",
                ),
                slug,
            )
            .await;

        assert!(
            matches!(result, Err(DocumentError::BadRequest(_))),
            "expected {slug:?} to be rejected, got {result:?}"
        );
    }
}

#[tokio::test]
async fn get_document_by_team_slug_rejects_non_positive_and_overflowing_numbers() {
    for slug in ["engineering-0", "engineering--1", "engineering-2147483648"] {
        let mut repo = make_mock_repo();
        repo.expect_get_document_id_by_team_task_number().times(0);
        repo.expect_get_basic_document().times(0);

        let result = make_test_service(repo)
            .get_document_by_team_slug(
                member_team_receipt(
                    "00000000-0000-0000-0000-000000000701",
                    "macro|user@user.com",
                ),
                slug,
            )
            .await;

        assert!(
            matches!(result, Err(DocumentError::BadRequest(_))),
            "expected {slug:?} to be rejected, got {result:?}"
        );
    }
}

#[tokio::test]
async fn get_document_by_team_slug_rejects_wrong_receipt_entity_type() {
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number().times(0);
    repo.expect_get_basic_document().times(0);
    let receipt = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        "00000000-0000-0000-0000-000000000701",
        EntityType::Document,
    );

    let result = make_test_service(repo)
        .get_document_by_team_slug(receipt, "engineering-1")
        .await;

    assert!(matches!(result, Err(DocumentError::BadRequest(_))));
}

#[tokio::test]
async fn get_document_by_team_slug_rejects_malformed_team_uuid() {
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number().times(0);
    repo.expect_get_basic_document().times(0);

    let result = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt("not-a-team-uuid", "macro|user@user.com"),
            "engineering-1",
        )
        .await;

    assert!(matches!(result, Err(DocumentError::BadRequest(_))));
}

#[tokio::test]
async fn get_document_by_team_slug_maps_missing_lookup_to_not_found() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000701");
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number()
        .withf(move |actual_team_id, task_num| actual_team_id == &team_id && *task_num == 404)
        .return_once(|_, _| Box::pin(std::future::ready(Ok(None))));
    repo.expect_get_basic_document().times(0);

    let result = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt(&team_id.to_string(), "macro|user@user.com"),
            "engineering-404",
        )
        .await;

    assert!(matches!(
        result,
        Err(DocumentError::NotFound(slug)) if slug == "engineering-404"
    ));
}

#[tokio::test]
async fn get_document_by_team_slug_maps_lookup_error_to_internal() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000701");
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number()
        .return_once(|_, _| Box::pin(std::future::ready(Err(anyhow!("database unavailable")))));
    repo.expect_get_basic_document().times(0);

    let result = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt(&team_id.to_string(), "macro|user@user.com"),
            "engineering-1",
        )
        .await;

    assert!(matches!(result, Err(DocumentError::Internal(_))));
}

#[tokio::test]
async fn get_document_by_team_slug_maps_document_load_error_to_internal() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000701");
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number()
        .return_once(|_, _| Box::pin(std::future::ready(Ok(Some("doc-1".to_string())))));
    repo.expect_get_basic_document()
        .return_once(|_| Box::pin(std::future::ready(Err(anyhow!("database unavailable")))));

    let result = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt(&team_id.to_string(), "macro|user@user.com"),
            "engineering-1",
        )
        .await;

    assert!(matches!(result, Err(DocumentError::Internal(_))));
}

#[tokio::test]
async fn get_document_by_team_slug_allows_owner_of_deleted_document() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000701");
    let mut document = task_document_context("doc-1");
    document.deleted_at = Some(chrono::Utc::now());
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number()
        .return_once(|_, _| Box::pin(std::future::ready(Ok(Some("doc-1".to_string())))));
    repo.expect_get_basic_document()
        .return_once(move |_| Box::pin(std::future::ready(Ok(document))));

    let result = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt(&team_id.to_string(), "macro|owner@user.com"),
            "engineering-1",
        )
        .await;

    assert_eq!(result.unwrap(), "doc-1");
}

#[tokio::test]
async fn get_document_by_team_slug_rejects_non_owner_of_deleted_document() {
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000701");
    let mut document = task_document_context("doc-1");
    document.deleted_at = Some(chrono::Utc::now());
    let mut repo = make_mock_repo();
    repo.expect_get_document_id_by_team_task_number()
        .return_once(|_, _| Box::pin(std::future::ready(Ok(Some("doc-1".to_string())))));
    repo.expect_get_basic_document()
        .return_once(move |_| Box::pin(std::future::ready(Ok(document))));

    let result = make_test_service(repo)
        .get_document_by_team_slug(
            member_team_receipt(&team_id.to_string(), "macro|user@user.com"),
            "engineering-1",
        )
        .await;

    assert!(matches!(result, Err(DocumentError::Unauthorized)));
}

#[tokio::test]
async fn bot_document_has_no_saved_user_view_location() {
    let mut repo = make_mock_repo();
    let metadata = make_test_metadata();

    repo.expect_get_document_metadata()
        .return_once(move |_| Box::pin(std::future::ready(Ok(metadata))));
    repo.expect_get_user_view_location().times(0);
    repo.expect_get_persisted_document_content()
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(Some(DocumentContent::ready(
                DocumentContentLocation::ObjectStorage,
            )))))
        });
    repo.expect_get_team_task_metadata()
        .return_once(|_| Box::pin(std::future::ready(Ok(None))));

    let response = make_test_service(repo)
        .get_document(bot_receipt("doc-1"))
        .await
        .unwrap();

    assert_eq!(response.view_location, None);
}

#[tokio::test]
async fn bot_lifecycle_event_has_no_actor_user_id() {
    let mut repo = make_mock_repo();
    repo.expect_soft_delete_document()
        .withf(|id| id == "doc-1")
        .return_once(|_| Box::pin(std::future::ready(Ok(()))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);
    let receipt = EntityAccessReceipt::<OwnerAccessLevel>::dangerously_assert_bot(
        bot_id().into_storage_id(),
        bot_receipt_scope(),
        "doc-1",
        EntityType::Document,
    );

    service.delete_document(receipt, None).await.unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].payload["metadata"]["actor_user_id"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn bot_task_branch_uses_macro_fallback() {
    let document_id = "00000000-0000-0000-0000-000000000124";
    let service = make_test_service(make_mock_repo());

    let response = service
        .get_task_branch_name(bot_receipt(document_id), "Fix bot auth".to_string())
        .await
        .unwrap();

    assert_eq!(
        response.branch_name,
        build_task_branch_name(
            "macro",
            None,
            None,
            &short_id_for_entity_id(document_id).unwrap(),
            "Fix bot auth",
        )
    );
}

#[tokio::test]
async fn test_get_document_happy_path() {
    let mut repo = make_mock_repo();
    let metadata = make_test_metadata();
    let metadata_clone = metadata.clone();

    repo.expect_get_document_metadata()
        .withf(|id| id == "doc-1")
        .returning(move |_| Box::pin(std::future::ready(Ok(metadata_clone.clone()))));

    repo.expect_get_user_view_location()
        .withf(|uid, did| uid == "user-1" && did == "doc-1")
        .returning(|_, _| Box::pin(std::future::ready(Ok(Some("page-3".to_string())))));

    // We can't easily construct the full service because it needs SyncServiceClient + PgPool.
    // Instead, test the repo interaction directly via the trait.
    let result = repo.get_document_metadata("doc-1").await.unwrap();
    assert_eq!(result.document_id, "doc-1");
    assert_eq!(result.document_name, "test_doc");

    let view_loc = repo
        .get_user_view_location("user-1", "doc-1")
        .await
        .unwrap();
    assert_eq!(view_loc, Some("page-3".to_string()));
}

#[tokio::test]
async fn test_get_document_not_found() {
    let mut repo = make_mock_repo();

    repo.expect_get_document_metadata()
        .withf(|id| id == "nonexistent")
        .returning(|_| {
            Box::pin(std::future::ready(Err(anyhow!(
                "no rows returned by a query that expected to return at least one row"
            ))))
        });

    let result = repo.get_document_metadata("nonexistent").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("no rows returned"));
}

#[tokio::test]
async fn test_soft_delete_document() {
    let mut repo = make_mock_repo();

    repo.expect_soft_delete_document()
        .withf(|id| id == "doc-1")
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let result = repo.soft_delete_document("doc-1").await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn bot_pull_request_does_not_hydrate_foreign_entity() {
    let document_id = "00000000-0000-0000-0000-000000000125";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000126");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/17".to_string(),
            ])))
        });

    let service = make_test_service_with_foreign_entities(
        repo,
        vec![make_foreign_entity(
            foreign_entity_id,
            "macro/repo/pull/17",
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            bot_id().into_storage_id().as_ref(),
            "bot",
        )],
    );

    let response = service
        .get_task_github_pull_requests(
            bot_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_raw_pull_request(
        &response.pull_requests[0],
        "macro/repo/pull/17",
        "macro",
        "repo",
        17,
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_returns_raw_refs_for_authenticated_user() {
    let document_id = "00000000-0000-0000-0000-000000000001";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/7".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, Vec::new());

    let service = make_test_service(repo);

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_raw_pull_request(
        &response.pull_requests[0],
        "macro/repo/pull/7",
        "macro",
        "repo",
        7,
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_adds_user_foreign_entity_id() {
    let document_id = "00000000-0000-0000-0000-000000000002";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000101");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/8".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, Vec::new());

    let service = make_test_service_with_foreign_entities(
        repo,
        vec![make_foreign_entity(
            foreign_entity_id,
            "macro/repo/pull/8",
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            "macro|user@user.com",
            "user",
        )],
    );

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_pull_request_ref(
        &response.pull_requests[0],
        "macro/repo/pull/8",
        "macro",
        "repo",
        8,
    );
    assert_eq!(
        response.pull_requests[0].foreign_entity_id,
        Some(foreign_entity_id)
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_hydrates_visible_foreign_entity_metadata() {
    let document_id = "00000000-0000-0000-0000-000000000008";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000501");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/14".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, Vec::new());

    let metadata = serde_json::json!({
        "githubKey": "macro/repo/pull/14",
        "owner": "macro",
        "repo": "repo",
        "number": 14,
        "url": "https://github.com/macro/repo/pull/14",
        "displayName": "macro/repo#14",
        "name": "Hydrate GitHub pull request metadata",
        "status": "open",
        "additions": 120,
        "deletions": 34,
        "comments": [
            {
                "id": 9001,
                "body": "Looks ready to merge.",
                "authorLogin": "alice",
                "authorAssociation": "MEMBER",
                "url": "https://github.com/macro/repo/pull/14#issuecomment-9001",
                "createdAt": "2026-06-09T12:00:00Z",
                "updatedAt": "2026-06-09T12:05:00Z",
                "source": "issue_comment"
            }
        ],
        "checks": [
            {
                "id": 7001,
                "name": "ci/test",
                "status": "completed",
                "conclusion": "success",
                "url": "https://github.com/macro/repo/actions/runs/7001",
                "startedAt": "2026-06-09T11:00:00Z",
                "completedAt": "2026-06-09T11:03:00Z"
            }
        ]
    });

    let service = make_test_service_with_foreign_entities(
        repo,
        vec![make_foreign_entity_with_metadata(
            foreign_entity_id,
            "macro/repo/pull/14",
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            "macro|user@user.com",
            "user",
            metadata.clone(),
        )],
    );

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    let mut expected_pull_request = metadata;
    expected_pull_request.as_object_mut().unwrap().insert(
        "foreignEntityId".to_string(),
        serde_json::json!(foreign_entity_id.to_string()),
    );
    assert_eq!(
        serde_json::to_value(&response.pull_requests[0]).unwrap(),
        expected_pull_request
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_falls_back_when_foreign_entity_metadata_is_malformed() {
    let document_id = "00000000-0000-0000-0000-000000000009";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let malformed_foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000601");
    let mismatched_foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000602");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/15".to_string(),
                "macro/repo/pull/16".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, Vec::new());

    let service = make_test_service_with_foreign_entities(
        repo,
        vec![
            make_foreign_entity_with_metadata(
                malformed_foreign_entity_id,
                "macro/repo/pull/15",
                GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
                "macro|user@user.com",
                "user",
                serde_json::json!({
                    "githubKey": "macro/repo/pull/15",
                    "owner": "macro"
                }),
            ),
            make_foreign_entity_with_metadata(
                mismatched_foreign_entity_id,
                "macro/repo/pull/16",
                GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
                "macro|user@user.com",
                "user",
                serde_json::json!({
                    "githubKey": "macro/repo/pull/999",
                    "owner": "macro",
                    "repo": "repo",
                    "number": 999,
                    "url": "https://github.com/macro/repo/pull/999",
                    "displayName": "macro/repo#999",
                    "name": "Wrong pull request metadata",
                    "status": "merged",
                    "additions": 999,
                    "deletions": 999,
                    "comments": [],
                    "checks": []
                }),
            ),
        ],
    );

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 2);
    assert_shallow_pull_request_with_foreign_entity_id(
        &response.pull_requests[0],
        "macro/repo/pull/15",
        "macro",
        "repo",
        15,
        malformed_foreign_entity_id,
    );
    assert_shallow_pull_request_with_foreign_entity_id(
        &response.pull_requests[1],
        "macro/repo/pull/16",
        "macro",
        "repo",
        16,
        mismatched_foreign_entity_id,
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_adds_team_foreign_entity_id() {
    let document_id = "00000000-0000-0000-0000-000000000003";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let team_id = uuid::uuid!("00000000-0000-0000-0000-000000000201");
    let foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000202");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/9".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, vec![team_id]);

    let service = make_test_service_with_foreign_entities(
        repo,
        vec![make_foreign_entity(
            foreign_entity_id,
            "macro/repo/pull/9",
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            &team_id.to_string(),
            "team",
        )],
    );

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_pull_request_ref(
        &response.pull_requests[0],
        "macro/repo/pull/9",
        "macro",
        "repo",
        9,
    );
    assert_eq!(
        response.pull_requests[0].foreign_entity_id,
        Some(foreign_entity_id)
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_ignores_unrelated_foreign_entity_source() {
    let document_id = "00000000-0000-0000-0000-000000000004";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let unrelated_foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000301");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/10".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, Vec::new());

    let foreign_entity_service = TestForeignEntityService::new(vec![make_foreign_entity(
        unrelated_foreign_entity_id,
        "macro/repo/pull/10",
        "linear_issue",
        "macro|user@user.com",
        "user",
    )]);
    let lookup_requests = foreign_entity_service.lookup_requests();
    let service = make_test_service_with_foreign_entity_service(repo, foreign_entity_service);

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_raw_pull_request(
        &response.pull_requests[0],
        "macro/repo/pull/10",
        "macro",
        "repo",
        10,
    );
    assert_eq!(
        *lookup_requests.lock().unwrap(),
        vec![ForeignEntityLookupRequest {
            foreign_entity_id: "macro/repo/pull/10".to_string(),
            foreign_entity_source: Some(GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string()),
        }]
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_ignores_unrelated_stored_source() {
    let document_id = "00000000-0000-0000-0000-000000000005";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let unrelated_foreign_entity_id = uuid::uuid!("00000000-0000-0000-0000-000000000401");
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/11".to_string(),
            ])))
        });
    expect_authenticated_team_lookup(&mut repo, Vec::new());

    let service = make_test_service_with_foreign_entities(
        repo,
        vec![make_foreign_entity_with_metadata(
            unrelated_foreign_entity_id,
            "macro/repo/pull/11",
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            "macro|other@user.com",
            "user",
            serde_json::json!({
                "githubKey": "macro/repo/pull/11",
                "owner": "macro",
                "repo": "repo",
                "number": 11,
                "url": "https://github.com/macro/repo/pull/11",
                "displayName": "macro/repo#11",
                "name": "Invisible pull request metadata",
                "status": "open",
                "additions": 55,
                "deletions": 13,
                "comments": [
                    {
                        "id": 3001,
                        "body": "This comment should not be visible.",
                        "authorLogin": "mallory",
                        "authorAssociation": "CONTRIBUTOR",
                        "url": "https://github.com/macro/repo/pull/11#issuecomment-3001",
                        "createdAt": "2026-06-09T10:00:00Z",
                        "updatedAt": "2026-06-09T10:01:00Z",
                        "source": "issue_comment"
                    }
                ],
                "checks": [
                    {
                        "id": 3002,
                        "name": "ci/private",
                        "status": "completed",
                        "conclusion": "failure",
                        "url": "https://github.com/macro/repo/actions/runs/3002",
                        "startedAt": "2026-06-09T09:00:00Z",
                        "completedAt": "2026-06-09T09:04:00Z"
                    }
                ]
            }),
        )],
    );

    let response = service
        .get_task_github_pull_requests(
            authenticated_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_raw_pull_request(
        &response.pull_requests[0],
        "macro/repo/pull/11",
        "macro",
        "repo",
        11,
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_returns_raw_refs_for_internal_access() {
    let document_id = "00000000-0000-0000-0000-000000000006";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/12".to_string(),
            ])))
        });

    let service = make_test_service(repo);

    let response = service
        .get_task_github_pull_requests(
            internal_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_raw_pull_request(
        &response.pull_requests[0],
        "macro/repo/pull/12",
        "macro",
        "repo",
        12,
    );
}

#[tokio::test]
async fn test_get_task_github_pull_requests_skips_malformed_keys_before_lookup() {
    let document_id = "00000000-0000-0000-0000-000000000007";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "not-a-pr-key".to_string(),
                "macro/repo/pull/13".to_string(),
            ])))
        });

    let foreign_entity_service = TestForeignEntityService::default();
    let lookup_requests = foreign_entity_service.lookup_requests();
    let service = make_test_service_with_foreign_entity_service(repo, foreign_entity_service);

    let response = service
        .get_task_github_pull_requests(
            internal_receipt(document_id),
            &task_document_context(document_id),
        )
        .await
        .unwrap();

    assert_eq!(response.pull_requests.len(), 1);
    assert_raw_pull_request(
        &response.pull_requests[0],
        "macro/repo/pull/13",
        "macro",
        "repo",
        13,
    );
    assert_eq!(
        *lookup_requests.lock().unwrap(),
        vec![ForeignEntityLookupRequest {
            foreign_entity_id: "macro/repo/pull/13".to_string(),
            foreign_entity_source: Some(GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.to_string()),
        }]
    );
}

fn owner_receipt(document_id: &str) -> EntityAccessReceipt<OwnerAccessLevel> {
    let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
        .unwrap()
        .into_owned();

    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user_id,
        document_id,
        EntityType::Document,
    )
}

fn edit_receipt(document_id: &str) -> EntityAccessReceipt<EditAccessLevel> {
    let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
        .unwrap()
        .into_owned();

    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user_id,
        document_id,
        EntityType::Document,
    )
}

#[tokio::test]
async fn content_uploaded_publishes_document_event_with_owner_and_version() {
    let mut repo = make_mock_repo();
    repo.expect_get_basic_document()
        .withf(|document_id| document_id == "doc-1")
        .return_once(|_| Box::pin(std::future::ready(Ok(task_document_context("doc-1")))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    service
        .publish_content_uploaded("doc-1", FileType::Pdf, Some("convert".to_string()))
        .await
        .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.documents");
    assert_eq!(event.key, "doc-1");
    assert_eq!(event.payload["event_type"], "document.content_uploaded");
    assert_eq!(event.payload["metadata"]["document_id"], "doc-1");
    assert_eq!(event.payload["metadata"]["owner"], "macro|owner@user.com");
    assert_eq!(event.payload["metadata"]["file_type"], "pdf");
    assert_eq!(event.payload["metadata"]["document_version_id"], "convert");
}

#[tokio::test]
async fn content_uploaded_preserves_an_absent_version() {
    let mut repo = make_mock_repo();
    repo.expect_get_basic_document()
        .return_once(|_| Box::pin(std::future::ready(Ok(task_document_context("doc-1")))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    service
        .publish_content_uploaded("doc-1", FileType::Pdf, None)
        .await
        .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(
        published[0].payload["metadata"]["document_version_id"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn content_uploaded_maps_a_missing_document_to_not_found() {
    let mut repo = make_mock_repo();
    repo.expect_get_basic_document().return_once(|_| {
        Box::pin(std::future::ready(Err(anyhow!(
            "no rows returned by a query that expected to return at least one row"
        ))))
    });

    let (service, event_broker) = make_test_service_with_event_broker(repo);
    let result = service
        .publish_content_uploaded("missing-doc", FileType::Pdf, None)
        .await;

    assert!(matches!(
        result,
        Err(DocumentError::NotFound(document_id)) if document_id == "missing-doc"
    ));
    assert!(event_broker.published().lock().unwrap().is_empty());
}

#[tokio::test]
async fn content_uploaded_maps_an_immediate_broker_failure_to_internal() {
    let mut repo = make_mock_repo();
    repo.expect_get_basic_document()
        .return_once(|_| Box::pin(std::future::ready(Ok(task_document_context("doc-1")))));
    let event_broker = TestEventBroker::failing();
    let (service, event_broker) =
        make_test_service_with_configured_event_broker(repo, event_broker);

    let result = service
        .publish_content_uploaded("doc-1", FileType::Pdf, None)
        .await;

    assert!(matches!(result, Err(DocumentError::Internal(_))));
    assert!(event_broker.published().lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_delete_document_publishes_document_deleted_event() {
    let mut repo = make_mock_repo();
    repo.expect_soft_delete_document()
        .withf(|id| id == "doc-1")
        .returning(|_| Box::pin(std::future::ready(Ok(()))));
    repo.expect_update_project_modified()
        .withf(|id| id == "project-1")
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    service
        .delete_document(owner_receipt("doc-1"), Some("project-1".to_string()))
        .await
        .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.documents");
    assert_eq!(event.key, "doc-1");
    assert_eq!(event.payload["event_type"], "document.deleted");
    assert_eq!(event.payload["schema_version"], 1);
    assert_eq!(event.payload["metadata"]["document_id"], "doc-1");
    assert_eq!(
        event.payload["metadata"]["actor_user_id"],
        "macro|user@user.com"
    );
    assert_eq!(event.payload["metadata"]["project_id"], "project-1");
    assert!(
        uuid::Uuid::parse_str(event.payload["event_id"].as_str().unwrap()).is_ok(),
        "event_id should be a valid uuid: {:?}",
        event.payload["event_id"]
    );
}

#[tokio::test]
async fn test_delete_document_publishes_no_event_when_repo_fails() {
    let mut repo = make_mock_repo();
    repo.expect_soft_delete_document()
        .withf(|id| id == "doc-1")
        .returning(|_| Box::pin(std::future::ready(Err(anyhow!("db is down")))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    let result = service.delete_document(owner_receipt("doc-1"), None).await;

    assert!(result.is_err());
    assert!(event_broker.published().lock().unwrap().is_empty());
}

#[tokio::test]
async fn edit_document_sets_revocation_intent_from_link_share_target() {
    for (link_share, expected_revocation) in [
        (Some(Some(LinkShare::Team)), true),
        (Some(None), true),
        (Some(Some(LinkShare::Public)), false),
        (None, false),
    ] {
        let mut repo = make_mock_repo();
        repo.expect_edit_document()
            .withf(move |args| {
                args.revoke_non_owner_user_access == expected_revocation
                    && args
                        .share_permission
                        .as_ref()
                        .is_some_and(|permission| permission.link_share == link_share)
            })
            .return_once(|_| Box::pin(std::future::ready(Ok(()))));

        make_test_service(repo)
            .edit_document(
                edit_receipt("doc-1"),
                task_document_context("doc-1"),
                EditDocumentServiceArgs {
                    document_name: None,
                    project_id: None,
                    share_permission: Some(UpdateSharePermissionRequestV2 {
                        link_share,
                        link_share_access_level: None,
                        channel_share_permissions: None,
                    }),
                    file_type: None,
                },
            )
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn test_edit_document_publishes_document_updated_event() {
    let mut repo = make_mock_repo();
    repo.expect_edit_document()
        .withf(|args| args.document_id == "doc-1" && !args.revoke_non_owner_user_access)
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    service
        .edit_document(
            edit_receipt("doc-1"),
            task_document_context("doc-1"),
            EditDocumentServiceArgs {
                document_name: Some("New name.md".to_string()),
                project_id: None,
                share_permission: None,
                file_type: None,
            },
        )
        .await
        .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.documents");
    assert_eq!(event.key, "doc-1");
    assert_eq!(event.payload["event_type"], "document.updated");
    assert_eq!(event.payload["metadata"]["document_name"], "New name");
    assert_eq!(event.payload["metadata"]["owner"], "macro|owner@user.com");
    assert_eq!(
        event.payload["metadata"]["actor_user_id"],
        "macro|user@user.com"
    );
    assert_eq!(event.payload["metadata"]["share_permission_updated"], false);
    assert_eq!(
        event.payload["metadata"]["previous_project_id"],
        serde_json::Value::Null
    );
    assert_eq!(
        event.payload["metadata"]["project_id"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn test_edit_document_rename_only_keeps_project_access() {
    let document_id = uuid::Uuid::new_v4().to_string();
    let old_project_id = uuid::Uuid::new_v4();

    let mut repo = make_mock_repo();
    repo.expect_edit_document()
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let (service, entity_access) = make_test_service_with_entity_access(repo);

    let mut context = task_document_context(&document_id);
    context.project_id = Some(old_project_id.to_string());

    service
        .edit_document(
            edit_receipt(&document_id),
            context,
            EditDocumentServiceArgs {
                document_name: Some("New name".to_string()),
                project_id: None,
                share_permission: None,
                file_type: None,
            },
        )
        .await
        .unwrap();

    assert!(
        entity_access
            .removed_from_projects
            .lock()
            .unwrap()
            .is_empty()
    );
    assert!(entity_access.added_to_projects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn test_edit_document_project_change_moves_project_access() {
    let document_id = uuid::Uuid::new_v4().to_string();
    let old_project_id = uuid::Uuid::new_v4();
    let new_project_id = uuid::Uuid::new_v4();

    let mut repo = make_mock_repo();
    repo.expect_edit_document()
        .returning(|_| Box::pin(std::future::ready(Ok(()))));
    repo.expect_update_project_modified()
        .times(2)
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let (service, entity_access) = make_test_service_with_entity_access(repo);

    let mut context = task_document_context(&document_id);
    context.project_id = Some(old_project_id.to_string());

    service
        .edit_document(
            edit_receipt(&document_id),
            context,
            EditDocumentServiceArgs {
                document_name: None,
                project_id: Some(new_project_id.to_string()),
                share_permission: None,
                file_type: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(
        *entity_access.removed_from_projects.lock().unwrap(),
        vec![old_project_id]
    );
    assert_eq!(
        *entity_access.added_to_projects.lock().unwrap(),
        vec![new_project_id]
    );
}

#[tokio::test]
async fn copy_document_best_effort_bumps_inherited_project_and_publishes_event() {
    let mut repo = make_mock_repo();
    let original_metadata = make_test_metadata();
    let original_for_lookup = original_metadata.clone();
    repo.expect_get_document_metadata()
        .withf(|id| id == "doc-1")
        .returning(move |_| Box::pin(std::future::ready(Ok(original_for_lookup.clone()))));
    repo.expect_get_project_owner()
        .withf(|id| id == "project-1")
        .returning(|_| {
            Box::pin(std::future::ready(Ok(
                macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
                    .unwrap()
                    .into_owned(),
            )))
        });
    let mut copied_metadata = make_test_metadata();
    copied_metadata.document_id = "doc-2".to_string();
    copied_metadata.document_name = "copied doc".to_string();
    repo.expect_get_team_default_link_share()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));
    repo.expect_copy_document()
        .returning(move |_, _| Box::pin(std::future::ready(Ok(copied_metadata.clone()))));
    repo.expect_get_document_version_id()
        .returning(|_| Box::pin(std::future::ready(Ok((1, true)))));
    repo.expect_get_latest_document_version_id()
        .returning(|_| Box::pin(std::future::ready(Ok((1, true)))));
    repo.expect_set_document_content()
        .returning(|_, _| Box::pin(std::future::ready(Ok(()))));
    repo.expect_update_project_modified()
        .withf(|project_id| project_id == "project-1")
        .times(1)
        .returning(|_| Box::pin(std::future::ready(Err(anyhow!("db is down")))));
    repo.expect_get_team_task_metadata()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    let mut document_context = task_document_context("doc-1");
    document_context.file_type = Some("txt".to_string());
    document_context.sub_type = None;

    service
        .copy_document(
            authenticated_receipt("doc-1"),
            document_context,
            macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
                .unwrap()
                .into_owned(),
            "copied doc".to_string(),
            None,
            None,
        )
        .await
        .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    let event = &published[0];
    assert_eq!(event.topic, "macro.documents");
    assert_eq!(event.key, "doc-2");
    assert_eq!(event.payload["event_type"], "document.copied");
    assert_eq!(event.payload["metadata"]["document_id"], "doc-2");
    assert_eq!(event.payload["metadata"]["source_document_id"], "doc-1");
    assert_eq!(event.payload["metadata"]["document_name"], "copied doc");
    assert_eq!(event.payload["metadata"]["owner"], "macro|user@user.com");
}

fn create_document_repo_args(file_type: FileType) -> CreateDocumentRepoArgs {
    CreateDocumentRepoArgs {
        id: None,
        sha: "sha".to_string(),
        document_name: "doc".to_string(),
        user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        file_type: Some(file_type),
        project_id: None,
        team_id: None,
        created_at: None,
        sub_type: None,
        skip_history: false,
        attribution: None,
    }
}

async fn create_document_with_team_default(
    team_default: Option<models_permissions::share_permission::TeamLinkShareDefault>,
    file_type: FileType,
    expected_link_share: Option<models_permissions::share_permission::LinkShare>,
    expected_access_level: Option<models_permissions::share_permission::access_level::AccessLevel>,
) {
    let mut repo = make_mock_repo();
    repo.expect_get_team_default_link_share()
        .withf(|user_id| user_id == "macro|user@user.com")
        .returning(move |_| Box::pin(std::future::ready(Ok(team_default))));
    let created_metadata = make_test_metadata();
    repo.expect_create_document()
        .withf(move |_, share_permission| {
            share_permission.link_share == expected_link_share
                && share_permission.link_share_access_level == expected_access_level
        })
        .times(1)
        .returning(move |_, _| Box::pin(std::future::ready(Ok(created_metadata.clone()))));
    repo.expect_set_document_content()
        .returning(|_, _| Box::pin(std::future::ready(Ok(()))));
    repo.expect_get_team_task_metadata()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));

    let (service, _event_broker) = make_test_service_with_event_broker(repo);

    crate::domain::ports::DocumentService::create_document(
        &service,
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        create_document_repo_args(file_type),
        None,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn create_document_repo_receives_team_derived_share_permission() {
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::share_permission::{LinkShare, TeamLinkShareDefault};

    // Team scope applies; a non-md doc has no entity level so it falls back to View.
    create_document_with_team_default(
        Some(TeamLinkShareDefault(Some(LinkShare::Team))),
        FileType::Txt,
        Some(LinkShare::Team),
        Some(AccessLevel::View),
    )
    .await;

    // Md keeps its Edit level under a team scope.
    create_document_with_team_default(
        Some(TeamLinkShareDefault(Some(LinkShare::Team))),
        FileType::Md,
        Some(LinkShare::Team),
        Some(AccessLevel::Edit),
    )
    .await;
}

#[tokio::test]
async fn create_document_repo_receives_entity_default_without_team() {
    use models_permissions::share_permission::LinkShare;
    use models_permissions::share_permission::access_level::AccessLevel;

    create_document_with_team_default(
        None,
        FileType::Md,
        Some(LinkShare::Public),
        Some(AccessLevel::Edit),
    )
    .await;
    create_document_with_team_default(None, FileType::Txt, None, None).await;
}

#[tokio::test]
async fn create_document_repo_receives_disabled_share_when_team_turned_link_share_off() {
    use models_permissions::share_permission::TeamLinkShareDefault;

    create_document_with_team_default(Some(TeamLinkShareDefault(None)), FileType::Md, None, None)
        .await;
}

#[tokio::test]
async fn create_document_publishes_resolved_attribution() {
    let mut repo = make_mock_repo();
    repo.expect_get_team_default_link_share()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));
    let created_metadata = make_test_metadata();
    repo.expect_import_email_attachment_document()
        .returning(move |_, _| {
            Box::pin(std::future::ready(Ok(EmailImportRepoOutcome::Created(
                created_metadata.clone(),
            ))))
        });
    repo.expect_set_document_content()
        .returning(|_, _| Box::pin(std::future::ready(Ok(()))));
    repo.expect_get_team_task_metadata()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);
    let args = ImportEmailAttachmentRepoArgs {
        email_attachment_id: uuid::Uuid::from_u128(7),
        create: create_document_repo_args(FileType::Txt),
    };

    crate::domain::ports::DocumentService::import_email_attachment(
        &service,
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        args,
    )
    .await
    .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published[0].payload["event_type"], "document.created");
    assert_eq!(
        published[0].payload["metadata"]["owner"],
        "macro|user@user.com"
    );
    assert_eq!(
        published[0].payload["metadata"]["actor"],
        bot_id::MACRO_SYSTEM_BOT_ID.into_storage_id().as_ref()
    );
    assert!(
        published[0].payload["metadata"]
            .get("on_behalf_of")
            .is_none()
    );
}

#[tokio::test]
async fn create_document_reuse_skips_content_url_and_created_event() {
    let mut repo = make_mock_repo();
    repo.expect_get_team_default_link_share()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));
    let created_metadata = make_test_metadata();
    repo.expect_import_email_attachment_document()
        .returning(move |_, _| {
            Box::pin(std::future::ready(Ok(EmailImportRepoOutcome::Reused(
                created_metadata.clone(),
            ))))
        });
    repo.expect_set_document_content().times(0);
    repo.expect_get_persisted_document_content()
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(Some(DocumentContent::ready(
                DocumentContentLocation::ObjectStorage,
            )))))
        });
    repo.expect_get_team_task_metadata()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);
    let args = ImportEmailAttachmentRepoArgs {
        email_attachment_id: uuid::Uuid::from_u128(9),
        create: create_document_repo_args(FileType::Txt),
    };

    let response = crate::domain::ports::DocumentService::import_email_attachment(
        &service,
        macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|user@user.com")
            .unwrap()
            .into_owned(),
        args,
    )
    .await
    .unwrap();

    assert!(response.document_response.presigned_url.is_none());
    assert_eq!(
        response
            .document_response
            .document_metadata
            .metadata
            .document_id,
        "doc-1"
    );
    assert_eq!(
        response.document_response.document_metadata.content,
        DocumentContent::ready(DocumentContentLocation::ObjectStorage),
    );
    assert!(event_broker.published().lock().unwrap().is_empty());
}

#[tokio::test]
async fn edited_interaction_bumps_document_before_publishing() {
    let mut repo = make_mock_repo();
    repo.expect_update_document_modified()
        .withf(|document_id| document_id == "doc-1")
        .times(1)
        .returning(|_| Box::pin(std::future::ready(Ok(()))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    service
        .record_interaction("doc-1", InteractionReason::Edited)
        .await
        .unwrap();

    let published = event_broker.published();
    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].topic, "macro.documents");
    assert_eq!(published[0].key, "doc-1");
    assert_eq!(published[0].payload["event_type"], "document.interaction");
    assert_eq!(published[0].payload["metadata"]["document_id"], "doc-1");
    assert_eq!(published[0].payload["metadata"]["reason"], "edited");
}

#[tokio::test]
async fn edited_interaction_does_not_publish_when_document_bump_fails() {
    let mut repo = make_mock_repo();
    repo.expect_update_document_modified()
        .withf(|document_id| document_id == "doc-1")
        .times(1)
        .returning(|_| Box::pin(std::future::ready(Err(anyhow!("db is down")))));

    let (service, event_broker) = make_test_service_with_event_broker(repo);

    let result = service
        .record_interaction("doc-1", InteractionReason::Edited)
        .await;

    assert_eq!(result.unwrap_err().to_string(), "db is down");
    assert!(event_broker.published().lock().unwrap().is_empty());
}

#[tokio::test]
async fn join_and_leave_interactions_publish_without_bumping_document() {
    for (reason, expected_reason) in [
        (InteractionReason::FirstJoin, "first_join"),
        (InteractionReason::LastLeave, "last_leave"),
    ] {
        let mut repo = make_mock_repo();
        repo.expect_update_document_modified().times(0);

        let (service, event_broker) = make_test_service_with_event_broker(repo);

        service.record_interaction("doc-1", reason).await.unwrap();

        let published = event_broker.published();
        let published = published.lock().unwrap();
        assert_eq!(published.len(), 1);
        assert_eq!(published[0].payload["event_type"], "document.interaction");
        assert_eq!(published[0].payload["metadata"]["reason"], expected_reason);
    }
}
