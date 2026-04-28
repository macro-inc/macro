use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use crate::domain::{
    models::{
        GithubError, GithubInstallationAccessToken, GithubKey, MacroTaskId,
        ValidatedGithubWebhookEvent,
    },
    ports::{GithubSyncClient, GithubSyncRepo, GithubSyncService},
};
use document_sub_type::DocumentSubType;
use documents::domain::models::EditDocumentServiceArgs;
use documents::domain::{
    models::{CreateDocumentRepoArgs, DocumentError, LocationQueryParams},
    ports::DocumentService,
};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{
    DocumentBasic, DocumentMetadata,
    response::{CreateDocumentResponseData, GetDocumentResponseData, LocationResponseV3},
};
use models_permissions::share_permission::access_level::AccessLevel;

use super::*;

/// UUID that corresponds to the short ID `2BuyvtY3aeEvHx4uG8iD51`.
const KNOWN_TASK_UUID: &str = "0d0dc589-f301-43f1-8b11-4ab448ca4bb4";

/// SAFETY: This is used for testing only
/// Minimal RSA private key used only for test JWT signing.
const TEST_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAky4t+NMylQ8TEjJIKciwvjKWM+5EzSXDkvc+dlNN2g0/wRsr
CTkFE9tQdEpJASbUz8+TRnExM8rbAB3p0tAyhAino2UDYvMRCBH5tGIBxKAPejZ2
pEv63Gzk7xAlbIKyoOqdf/VUs5rNOsiB+l6/0Dbi2nBXFEjbQTNt33LOY6Smqu5f
tcvN9gxHMr+m+vhnuUraL39sP0AWEhml/aw+LLIPlO1Cfp/on0sxRGmd0bhqTVWa
o3fVqp8xqopQ3nCkZaYu6EUIzdg/ioktPEgY3kul/IS2QvJAfLAmi20/ahMLXJ+v
izWM11Qs4jwfjKDxtXBgU70bv3WMC4aaU6o7JQIDAQABAoIBAHXS5UiqQncj3z+U
80JIAH3y313pZDja/4s61U1CeTOTobNEvZofhJoV232NLo52eK14Xk1pNlthDRs1
10dGFvquNw3OQvzG256bTUyDnSi8fkd3LFlw3f3ySv+67ErHApth1v5l9w3lYmCp
vawih+n21nrKrlt1y9iRhGb6cJFBOsF8lmcFo9ijEzbRyaW+ou8J0ty9GNuwioET
RaimVOo0nct0lrN4A269C+LqHLRUpj2MdxYEH4+1ziSCRDhCIQhPxd0ylpcXVEYP
XubG5Kad8bueXn9HPtvkhxJJ0P9rD0M6+enPh5CdFPRg1qQchsoqSvRDxN4kwf5k
XzbLw8ECgYEAxDQrvwDaGDMpcMrNaxtyatUfLi4uuinDNYuK+45XqMSWKXehINMc
5bva0WBT3brKAdAoDRmZtfDiVvwc6Z59/WBSh+Zq29iLftazUhgCLejWFdIVO/SE
vAx6v3Ctyl0XgrkkV2wtKtpj9T8EU+8O9HnduP075VXrMmOwrh8/qbECgYEAwAkz
UG1fTs29BIbtAXauqhp14QM+J91viSQ7kzRIyElxp7S9IkAWWzei5K4piJGxBGBg
QwgviN0cpK8URtfFIXQijzcYMwKhf0RqPrX9Kwh+9FGHcK0SHCx3JMdzkhtNrkR3
1w+cjhP3VqsoZo/+reT7Wy6E4FlcrY6Rbo2qkbUCgYBZJiNibC6spEKGH3/q1NPO
Ovwp7Y4JxIQQRlFmL60g4AIi4VpzIbmVoR+x1wUEUKUM4dnw6drv0n3lbDRu6jbw
891MJqQTNHddsIxWFtaWqZ7s10ISte3BzCHR7o7ozheqrBkZJ+v19rlIa9O5l3vC
FcVrEpUuhTWS9b0HwOcaYQKBgCuOqq32cOS9876gIAfx9IIuyEgGZUXDizXvGvgz
psKPLhFdBH1NTgTYpMD74/3PFfipJ4xsweNoS8Pq1k2PSW5iGiij1YBUe28ThIm+
27K0FZ+zEmZzSyVKzKdx+fvM55y8ePY120u6qaJl5h8FUD3/LygqcAc3HbdcHA6Y
YXT1AoGAUyOZ7RPz8dLHWMA0+bRM4XGNxbyIjULKC/Fjf9bM3GIUWG8klxmBkCQJ
MEt9yPb3VfwFUyBSNJt4C6zDrnd+62oT+A9aJHJcUDUjqdBsmZamDu7xBAeLGxsn
sNRx7TF4iOEBkdJgBUoY4X/rZ+51FQOrdZGqeWo+8TjBhMQN7b4=
-----END RSA PRIVATE KEY-----";

/// Recorded update_task_status call.
#[derive(Debug, Clone)]
struct TaskStatusCall {
    entity_id: String,
    status: String,
}

struct StubDocumentService {
    task_status_calls: Mutex<Vec<TaskStatusCall>>,
}

impl StubDocumentService {
    fn new() -> Self {
        Self {
            task_status_calls: Mutex::new(Vec::new()),
        }
    }

    fn task_status_calls(&self) -> Vec<TaskStatusCall> {
        self.task_status_calls.lock().unwrap().clone()
    }

    fn task_metadata(document_id: &str) -> DocumentMetadata {
        DocumentMetadata {
            document_id: document_id.to_string(),
            document_version_id: 1,
            owner: MacroUserIdStr::try_from_email("test@example.com").unwrap(),
            document_name: "My Task".to_string(),
            file_type: Some("md".to_string()),
            sha: None,
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
            sub_type: Some(DocumentSubType::Task),
        }
    }
}

impl DocumentService for StubDocumentService {
    async fn internal_get_basic_document(
        &self,
        _document_id: &str,
    ) -> Result<DocumentBasic, DocumentError> {
        unimplemented!()
    }
    async fn get_short_id(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        unimplemented!()
    }
    async fn get_document(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetDocumentResponseData, DocumentError> {
        let document_id = receipt.entity().entity_id.clone();
        if document_id == KNOWN_TASK_UUID {
            Ok(GetDocumentResponseData {
                document_metadata: Self::task_metadata(&document_id),
                user_access_level: AccessLevel::Owner,
                view_location: None,
            })
        } else {
            Err(DocumentError::NotFound(document_id))
        }
    }
    async fn get_document_location(
        &self,
        _ctx: &DocumentBasic,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _params: LocationQueryParams,
    ) -> Result<LocationResponseV3, DocumentError> {
        unimplemented!()
    }
    async fn delete_document(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
        _project_id: Option<String>,
    ) -> Result<(), DocumentError> {
        unimplemented!()
    }
    async fn get_document_text(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, DocumentError> {
        unimplemented!()
    }
    async fn create_document(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _args: CreateDocumentRepoArgs,
        _job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        unimplemented!()
    }
    async fn update_task_status(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        status: &str,
    ) -> Result<(), DocumentError> {
        self.task_status_calls.lock().unwrap().push(TaskStatusCall {
            entity_id: receipt.entity().entity_id.clone(),
            status: status.to_string(),
        });
        Ok(())
    }

    async fn edit_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        _document_basic: DocumentBasic,
        _request: EditDocumentServiceArgs,
    ) -> Result<(), DocumentError> {
        Ok(())
    }

    async fn copy_document(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        _document_context: DocumentBasic,
        _user_id: MacroUserIdStr<'static>,
        _document_name: String,
        _query_version_id: Option<i64>,
        _sync_version_id: Option<model::sync_service::SyncServiceVersionID>,
    ) -> Result<model::document::response::DocumentResponse, DocumentError> {
        unimplemented!()
    }

    async fn create_task(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _plain_user_id: String,
        _request: documents::domain::models::CreateTaskRequest,
    ) -> Result<documents::domain::models::CreateTaskResponse, DocumentError> {
        unimplemented!()
    }

    async fn get_document_comments(
        &self,
        _entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<documents::domain::models::CommentThread>, DocumentError> {
        unimplemented!()
    }

    async fn handle_task_properties(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _document_id: &str,
        _request: &documents::domain::models::CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        unimplemented!()
    }
}

/// Stateful stub repo that tracks task IDs per github key.
struct StubSyncRepo {
    tasks: Mutex<HashMap<String, HashSet<String>>>,
    /// Maps github_user_id -> macro_id for installation event lookups.
    github_links: Mutex<HashMap<String, String>>,
    /// Maps macro_id -> team_ids for installation event lookups.
    user_teams: Mutex<HashMap<String, Vec<uuid::Uuid>>>,
    /// Recorded installation-team association inserts: (installation_id, team_ids, installed_by).
    installation_associations: Mutex<Vec<(String, Vec<uuid::Uuid>, String)>>,
}

impl StubSyncRepo {
    fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            github_links: Mutex::new(HashMap::new()),
            user_teams: Mutex::new(HashMap::new()),
            installation_associations: Mutex::new(Vec::new()),
        }
    }

    fn with_github_link(self, github_user_id: &str, macro_id: &str) -> Self {
        self.github_links
            .lock()
            .unwrap()
            .insert(github_user_id.to_string(), macro_id.to_string());
        self
    }

    fn with_user_teams(self, macro_id: &str, team_ids: Vec<uuid::Uuid>) -> Self {
        self.user_teams
            .lock()
            .unwrap()
            .insert(macro_id.to_string(), team_ids);
        self
    }

    fn installation_associations(&self) -> Vec<(String, Vec<uuid::Uuid>, String)> {
        self.installation_associations.lock().unwrap().clone()
    }
}

impl GithubSyncRepo for StubSyncRepo {
    type Err = anyhow::Error;

    async fn get_task_ids(&self, github_key: GithubKey) -> Result<Vec<MacroTaskId>, Self::Err> {
        let tasks = self.tasks.lock().unwrap();
        let ids = tasks
            .get(github_key.as_ref())
            .map(|set| {
                set.iter()
                    .filter_map(|s| MacroTaskId::from_short_uuid(s))
                    .collect()
            })
            .unwrap_or_default();
        Ok(ids)
    }

    async fn upsert_task_ids(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> Result<(), Self::Err> {
        let mut tasks = self.tasks.lock().unwrap();
        let set = tasks.entry(github_key.as_ref().to_string()).or_default();
        for id in task_ids {
            set.insert(id.short_uuid.clone());
        }
        Ok(())
    }

    async fn filter_duplicate_tasks(
        &self,
        github_key: GithubKey,
        task_ids: &[MacroTaskId],
    ) -> Result<Vec<MacroTaskId>, Self::Err> {
        let tasks = self.tasks.lock().unwrap();
        let existing = tasks.get(github_key.as_ref());
        Ok(task_ids
            .iter()
            .filter(|t| {
                existing
                    .map(|set| !set.contains(&t.short_uuid))
                    .unwrap_or(true)
            })
            .cloned()
            .collect())
    }

    async fn get_macro_id_by_github_user_id(
        &self,
        github_user_id: &str,
    ) -> Result<Option<String>, Self::Err> {
        Ok(self
            .github_links
            .lock()
            .unwrap()
            .get(github_user_id)
            .cloned())
    }

    async fn get_user_team_ids(&self, macro_id: &str) -> Result<Vec<uuid::Uuid>, Self::Err> {
        Ok(self
            .user_teams
            .lock()
            .unwrap()
            .get(macro_id)
            .cloned()
            .unwrap_or_default())
    }

    async fn insert_installation_team_associations(
        &self,
        installation_id: &str,
        team_ids: &[uuid::Uuid],
        installed_by: &str,
    ) -> Result<(), Self::Err> {
        self.installation_associations.lock().unwrap().push((
            installation_id.to_string(),
            team_ids.to_vec(),
            installed_by.to_string(),
        ));
        Ok(())
    }
}

/// Recorded PR comment call.
#[derive(Debug, Clone)]
struct PrCommentCall {
    owner: String,
    repo: String,
    pull_number: u64,
    body: String,
}

struct StubSyncClient {
    pr_comments: Mutex<Vec<PrCommentCall>>,
}

impl StubSyncClient {
    fn new() -> Self {
        Self {
            pr_comments: Mutex::new(Vec::new()),
        }
    }

    fn pr_comments(&self) -> Vec<PrCommentCall> {
        self.pr_comments.lock().unwrap().clone()
    }
}

impl GithubSyncClient for StubSyncClient {
    async fn generate_installation_access_token(
        &self,
        _jwt: &str,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        Ok(GithubInstallationAccessToken {
            token: "test-token".to_string(),
            expires_at: "2099-01-01T00:00:00Z".to_string(),
        })
    }

    async fn create_pr_comment(
        &self,
        _access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
        body: &str,
    ) -> Result<(), GithubError> {
        self.pr_comments.lock().unwrap().push(PrCommentCall {
            owner: owner.to_string(),
            repo: repo.to_string(),
            pull_number,
            body: body.to_string(),
        });
        Ok(())
    }
}

fn make_sync_service() -> GithubSyncServiceImpl<StubDocumentService, StubSyncRepo, StubSyncClient> {
    make_sync_service_with_doc_service().0
}

fn make_sync_service_with_repo(
    repo: StubSyncRepo,
) -> GithubSyncServiceImpl<StubDocumentService, StubSyncRepo, StubSyncClient> {
    let doc_service = Arc::new(StubDocumentService::new());
    GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: "test-webhook-secret".to_string(),
            github_sync_app_url: "test".to_string(),
            sync_app_pem: TEST_PEM.to_string(),
            sync_app_client_id: "test-sync-app-client-id".to_string(),
        },
        doc_service,
        repo,
        StubSyncClient::new(),
    )
}

fn make_sync_service_with_doc_service() -> (
    GithubSyncServiceImpl<StubDocumentService, StubSyncRepo, StubSyncClient>,
    Arc<StubDocumentService>,
) {
    let doc_service = Arc::new(StubDocumentService::new());
    let service = GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: "test-webhook-secret".to_string(),
            github_sync_app_url: "test".to_string(),
            sync_app_pem: TEST_PEM.to_string(),
            sync_app_client_id: "test-sync-app-client-id".to_string(),
        },
        doc_service.clone(),
        StubSyncRepo::new(),
        StubSyncClient::new(),
    );
    (service, doc_service)
}

#[tokio::test]
async fn pr_with_task_id_in_title() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].owner, "my-org");
    assert_eq!(comments[0].repo, "my-repo");
    assert_eq!(comments[0].pull_number, 42);
    assert_eq!(
        comments[0].body,
        format!("[My Task](https://macro.com/app/task/{KNOWN_TASK_UUID})")
    );
}

#[tokio::test]
async fn pr_with_task_id_in_branch_name() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 7,
                "title": "some feature",
                "body": "no task ids here",
                "head": { "ref": "macro-2BuyvtY3aeEvHx4uG8iD51" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 7);
}

#[tokio::test]
async fn issue_comment_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "some issue",
                "body": null,
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 99);
}

#[tokio::test]
async fn event_with_no_task_ids() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "title": "just a normal PR",
                "body": "nothing special",
                "head": { "ref": "feature/no-task-id" }
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn unknown_event_type_skipped() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "ping".to_string(),
        serde_json::json!({"zen": "Keep it logically awesome."}),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn multiple_task_ids_in_one_event() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "title": "closes MACRO-abc123",
                "body": "also relates to MACRO-def456 and MACRO-ghi789",
                "head": { "ref": "main" }
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn pull_request_review_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review".to_string(),
        serde_json::json!({
            "action": "submitted",
            "pull_request": {
                "number": 10,
                "title": "some PR",
                "body": null,
                "head": { "ref": "main" }
            },
            "review": {
                "body": "Approved, relates to MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());

    let comments = service.client.pr_comments();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].pull_number, 10);
}

#[tokio::test]
async fn pull_request_review_comment_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "comment": {
                "body": "This line is related to MACRO-abc123"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// Deduplication: repo tracks tasks already associated with a PR
// ---------------------------------------------------------------------------

#[tokio::test]
async fn duplicate_comment_not_posted_when_task_already_tracked() {
    let service = make_sync_service();

    let make_event = || {
        ValidatedGithubWebhookEvent::new(
            "pull_request".to_string(),
            serde_json::json!({
                "action": "opened",
                "pull_request": {
                    "number": 42,
                    "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                    "body": null,
                    "head": { "ref": "feature/some-branch" }
                },
                "repository": {
                    "name": "my-repo",
                    "owner": { "login": "my-org" }
                },
                "installation": { "id": 12345 }
            }),
        )
    };

    // First event — comment should be posted
    let event = make_event();
    service.process_webhook_event(&event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);

    // Second event with same task ID — should NOT post a duplicate
    let event = make_event();
    service.process_webhook_event(&event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);
}

// ---------------------------------------------------------------------------
// Deduplication: comment mentions task ID already in PR context
// ---------------------------------------------------------------------------

#[tokio::test]
async fn issue_comment_duplicate_task_id_skipped() {
    let service = make_sync_service();

    // First, open the PR with the task ID to populate the repo
    let pr_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 99,
                "title": "fixes MACRO-abc123",
                "body": null,
                "head": { "ref": "main" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&pr_event).await.unwrap();

    // Comment mentions the same task ID — should be skipped
    let comment_event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "fixes MACRO-abc123",
                "body": null,
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "Fixes MACRO-abc123"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    let result = service.process_webhook_event(&comment_event).await;
    assert!(result.is_ok());
    // No additional comment posted (PR open posted one, comment should not)
    assert_eq!(service.client.pr_comments().len(), 0);
}

#[tokio::test]
async fn issue_comment_new_task_id_not_skipped() {
    let service = make_sync_service();
    // Comment introduces a new task ID not previously tracked
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "title": "fixes MACRO-abc123",
                "body": null,
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "Also fixes MACRO-def456"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn review_duplicate_task_id_skipped_via_pr_context() {
    let service = make_sync_service();
    // PR title already has the task ID. The comment handler upserts PR context
    // tasks, so the review body's mention is considered a duplicate.
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review".to_string(),
        serde_json::json!({
            "action": "submitted",
            "pull_request": {
                "title": "MACRO-abc123 fix",
                "body": null,
                "head": { "ref": "main" }
            },
            "review": {
                "body": "Approved, relates to MACRO-abc123"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn review_comment_mixed_new_and_duplicate() {
    let service = make_sync_service();
    // PR has MACRO-abc123 in branch (will be upserted as PR context),
    // comment mentions both abc123 (dup via context) and def456 (new)
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request_review_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "pull_request": {
                "title": "some fix",
                "body": null,
                "head": { "ref": "feature/macro-abc123" }
            },
            "comment": {
                "body": "Relates to MACRO-abc123 and MACRO-def456"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// Task status updates based on PR action
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pr_opened_sets_task_status_in_review() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "In Review");
}

#[tokio::test]
async fn pr_merged_sets_task_status_completed() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "Completed");
}

#[tokio::test]
async fn pr_closed_without_merge_sets_task_status_canceled() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "Canceled");
}

#[tokio::test]
async fn issue_comment_on_open_pr_sets_task_status_in_review() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "some issue",
                "body": null,
                "state": "open",
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[0].status, "In Review");
}

#[tokio::test]
async fn issue_comment_on_closed_pr_does_not_update_task_status() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "some issue",
                "body": null,
                "state": "closed",
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    let status_calls = doc_service.task_status_calls();
    assert!(
        status_calls.is_empty(),
        "issue_comment on closed PR should not update task status"
    );
}

#[tokio::test]
async fn pr_merged_updates_status_even_when_already_tracked() {
    let (service, doc_service) = make_sync_service_with_doc_service();

    // First event: PR opened — posts comment and sets "In Review"
    let opened_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&opened_event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);
    assert_eq!(doc_service.task_status_calls().len(), 1);
    assert_eq!(doc_service.task_status_calls()[0].status, "In Review");

    // Second event: PR merged — should NOT post a duplicate comment,
    // but SHOULD update status to "Completed"
    let merged_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&merged_event).await.unwrap();

    // Still only 1 comment (no duplicate)
    assert_eq!(service.client.pr_comments().len(), 1);

    // But status was updated twice: "In Review" then "Completed"
    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 2);
    assert_eq!(status_calls[1].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[1].status, "Completed");
}

// ---------------------------------------------------------------------------
// New behavioral tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pr_close_does_not_post_comment() {
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    // No comment posted on close
    assert!(
        service.client.pr_comments().is_empty(),
        "PR close should not post a new bot comment"
    );

    // But status should still be updated
    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 1);
    assert_eq!(status_calls[0].status, "Completed");
}

#[tokio::test]
async fn pr_open_does_not_search_existing_comments() {
    // On open, only PR title/body/branch are searched — not existing comments.
    // No tasks in the PR text, so nothing should happen.
    let (service, doc_service) = make_sync_service_with_doc_service();

    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "just a normal PR",
                "body": null,
                "head": { "ref": "feature/some-branch" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    assert!(service.client.pr_comments().is_empty());
    assert!(doc_service.task_status_calls().is_empty());
}

#[tokio::test]
async fn pr_close_picks_up_task_from_repo() {
    let (service, doc_service) = make_sync_service_with_doc_service();

    // First, open PR with the task to populate the repo
    let open_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": false
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&open_event).await.unwrap();

    // Close with a different title (no task ID in text), but repo remembers it
    let close_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "some feature",
                "body": null,
                "head": { "ref": "feature/some-branch" },
                "merged": true
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&close_event).await.unwrap();

    // No comment posted on close
    assert_eq!(service.client.pr_comments().len(), 1); // only from open

    // Status should be updated from repo-tracked task
    let status_calls = doc_service.task_status_calls();
    assert_eq!(status_calls.len(), 2); // "In Review" from open, "Completed" from close
    assert_eq!(status_calls[1].entity_id, KNOWN_TASK_UUID);
    assert_eq!(status_calls[1].status, "Completed");
}

#[tokio::test]
async fn comment_deduplicates_against_repo() {
    let (service, _doc_service) = make_sync_service_with_doc_service();

    // Open PR with a task — tracked in repo
    let pr_event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 99,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "main" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&pr_event).await.unwrap();
    assert_eq!(service.client.pr_comments().len(), 1);

    // A comment mentions the same task ID — should be deduped by the repo
    let comment_event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "issue": {
                "number": 99,
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "state": "open",
                "head": { "ref": "main" }
            },
            "comment": {
                "body": "Also see MACRO-2BuyvtY3aeEvHx4uG8iD51"
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&comment_event).await.unwrap();

    // No additional comment — task was already tracked in repo
    assert_eq!(
        service.client.pr_comments().len(),
        1,
        "comment should not re-trigger for task already tracked in repo"
    );
}

#[tokio::test]
async fn false_positive_macro_prefix_ignored() {
    // "macro-inc" matches the regex but does not correspond to a real task document.
    let (service, doc_service) = make_sync_service_with_doc_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "number": 42,
                "title": "update macro-inc dependency",
                "body": null,
                "head": { "ref": "feature/update-deps" }
            },
            "repository": {
                "name": "my-repo",
                "owner": { "login": "my-org" }
            },
            "installation": { "id": 12345 }
        }),
    );

    service.process_webhook_event(&event).await.unwrap();

    assert!(
        service.client.pr_comments().is_empty(),
        "false positive macro- prefix should not trigger a comment"
    );
    assert!(
        doc_service.task_status_calls().is_empty(),
        "false positive macro- prefix should not trigger a status update"
    );
}

// ---------------------------------------------------------------------------
// installation created
// ---------------------------------------------------------------------------

fn installation_created_event(sender_id: u64, installation_id: u64) -> ValidatedGithubWebhookEvent {
    ValidatedGithubWebhookEvent::new(
        "installation".to_string(),
        serde_json::json!({
            "action": "created",
            "installation": { "id": installation_id },
            "sender": { "login": "testuser", "id": sender_id }
        }),
    )
}

#[tokio::test]
async fn installation_created_associates_teams() {
    let team_a: uuid::Uuid = "dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap();
    let team_b: uuid::Uuid = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".parse().unwrap();

    let repo = StubSyncRepo::new()
        .with_github_link("12345", "macro|user@user.com")
        .with_user_teams("macro|user@user.com", vec![team_a, team_b]);

    let service = make_sync_service_with_repo(repo);
    let event = installation_created_event(12345, 99999);

    service.process_webhook_event(&event).await.unwrap();

    let associations = service.repo.installation_associations();
    assert_eq!(associations.len(), 1);
    assert_eq!(associations[0].0, "99999");
    assert_eq!(associations[0].1.len(), 2);
    assert!(associations[0].1.contains(&team_a));
    assert!(associations[0].1.contains(&team_b));
    assert_eq!(associations[0].2, "macro|user@user.com");
}

#[tokio::test]
async fn installation_created_no_github_link() {
    let service = make_sync_service();
    let event = installation_created_event(99999, 11111);

    // No github link for sender — should succeed without inserting anything
    service.process_webhook_event(&event).await.unwrap();

    assert!(service.repo.installation_associations().is_empty());
}

#[tokio::test]
async fn installation_created_no_teams() {
    let repo = StubSyncRepo::new().with_github_link("12345", "macro|user@user.com");
    // user_teams is empty by default

    let service = make_sync_service_with_repo(repo);
    let event = installation_created_event(12345, 11111);

    service.process_webhook_event(&event).await.unwrap();

    let associations = service.repo.installation_associations();
    assert!(associations.is_empty());
}

#[tokio::test]
async fn installation_deleted_is_skipped() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "installation".to_string(),
        serde_json::json!({
            "action": "deleted",
            "installation": { "id": 12345 },
            "sender": { "login": "testuser", "id": 12345 }
        }),
    );

    // Should not error — just skips
    service.process_webhook_event(&event).await.unwrap();

    assert!(service.repo.installation_associations().is_empty());
}
