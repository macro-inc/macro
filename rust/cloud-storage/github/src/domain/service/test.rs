use std::sync::{Arc, Mutex};

use crate::domain::{
    models::{GithubError, GithubInstallationAccessToken, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncService},
};
use document_sub_type::DocumentSubType;
use documents::domain::{
    models::{CreateDocumentRepoArgs, DocumentError, LocationQueryParams},
    ports::DocumentService,
};
use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel};
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

struct StubDocumentService;

impl StubDocumentService {
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

    async fn list_pr_comments(
        &self,
        _access_token: &str,
        _owner: &str,
        _repo: &str,
        _pull_number: u64,
    ) -> Result<Vec<String>, GithubError> {
        Ok(self
            .pr_comments
            .lock()
            .unwrap()
            .iter()
            .map(|c| c.body.clone())
            .collect())
    }
}

fn make_sync_service() -> GithubSyncServiceImpl<StubDocumentService, StubSyncClient> {
    GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: "test-webhook-secret".to_string(),
            github_sync_app_url: "test".to_string(),
            sync_app_pem: TEST_PEM.to_string(),
            sync_app_client_id: "test-sync-app-client-id".to_string(),
        },
        Arc::new(StubDocumentService),
        StubSyncClient::new(),
    )
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
// Deduplication: bot already posted a comment linking to the same task
// ---------------------------------------------------------------------------

#[tokio::test]
async fn duplicate_comment_not_posted_when_bot_already_commented() {
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
    // PR title already contains MACRO-abc123, comment also mentions it
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
                "body": "Fixes MACRO-abc123"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn issue_comment_new_task_id_not_skipped() {
    let service = make_sync_service();
    // PR title has MACRO-abc123, but comment introduces MACRO-def456
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
async fn review_duplicate_task_id_skipped() {
    let service = make_sync_service();
    // PR title already has the task ID, review body repeats it
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
    // PR has MACRO-abc123 in branch, comment mentions both abc123 (dup) and def456 (new)
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
