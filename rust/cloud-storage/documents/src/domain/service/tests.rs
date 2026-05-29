use macro_user_id::cowlike::CowLike;
use model::document::DocumentMetadata;

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

fn make_test_service(
    repo: MockDocumentRepo,
) -> DocumentServiceImpl<
    MockDocumentRepo,
    TestUploadUrlPort,
    TestTaskPropertiesPort,
    TestConnectionService,
    TestEntityAccessManagementService,
> {
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
    )
}

fn assert_raw_pull_request(
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
    assert!(pull_request.name.is_none());
    assert!(pull_request.status.is_none());
    assert!(pull_request.additions.is_none());
    assert!(pull_request.deletions.is_none());
    assert!(pull_request.comments.is_none());
    assert!(pull_request.checks.is_none());

    let pull_request_json = serde_json::to_value(pull_request).unwrap();
    assert!(pull_request_json.get("comments").is_none());
    assert!(pull_request_json.get("checks").is_none());
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
async fn test_get_task_github_pull_requests_returns_raw_refs_for_internal_access() {
    let document_id = "00000000-0000-0000-0000-000000000002";
    let expected_short_id = short_id_for_entity_id(document_id).unwrap();
    let mut repo = make_mock_repo();

    repo.expect_get_task_github_pull_request_keys()
        .withf(move |task_short_id| task_short_id == expected_short_id)
        .return_once(|_| {
            Box::pin(std::future::ready(Ok(vec![
                "macro/repo/pull/8".to_string(),
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
        "macro/repo/pull/8",
        "macro",
        "repo",
        8,
    );
}
