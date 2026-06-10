use foreign_entity::domain::models::{
    CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
};
use foreign_entity::domain::ports::{ForeignEntityListQuery, ForeignEntityService};
use macro_user_id::cowlike::CowLike;
use model::document::DocumentMetadata;
use std::sync::{Arc, Mutex};

use crate::domain::models::GithubPullRequest;
use crate::domain::ports::MockDocumentRepo;

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

#[derive(Clone)]
struct TestEntityAccessManagementService;

impl EntityAccessManagementService for TestEntityAccessManagementService {
    async fn add_entity_to_project(
        &self,
        _entity_id: &uuid::Uuid,
        _entity_type: EntityType,
        _project_id: &uuid::Uuid,
    ) -> Result<(), entity_access_management::domain::models::EntityAccessManagementError> {
        Ok(())
    }

    async fn remove_entity_from_project(
        &self,
        _entity_id: &uuid::Uuid,
        _entity_type: EntityType,
        _old_project_id: &uuid::Uuid,
    ) -> Result<(), entity_access_management::domain::models::EntityAccessManagementError> {
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

type TestDocumentService = DocumentServiceImpl<
    MockDocumentRepo,
    TestUploadUrlPort,
    TestTaskPropertiesPort,
    TestConnectionService,
    TestEntityAccessManagementService,
    TestForeignEntityService,
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
        TestEntityAccessManagementService,
        foreign_entity_service,
    )
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
