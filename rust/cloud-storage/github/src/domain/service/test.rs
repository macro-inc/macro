use std::sync::Arc;

use crate::domain::{
    models::{GithubError, GithubInstallationAccessToken, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncService},
};
use documents::domain::{
    models::{CreateDocumentRepoArgs, DocumentError, LocationQueryParams},
    ports::DocumentService,
};
use entity_access::domain::models::{EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{
    DocumentBasic,
    response::{CreateDocumentResponseData, GetDocumentResponseData, LocationResponseV3},
};

use super::*;

struct StubDocumentService;

impl DocumentService for StubDocumentService {
    async fn internal_get_basic_document(
        &self,
        _document_id: &str,
    ) -> Result<DocumentBasic, DocumentError> {
        unimplemented!()
    }
    async fn get_document(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<GetDocumentResponseData, DocumentError> {
        unimplemented!()
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

struct StubSyncClient;

impl GithubSyncClient for StubSyncClient {
    async fn generate_installation_access_token(
        &self,
        _jwt: &str,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        unimplemented!()
    }
}

fn make_sync_service() -> GithubSyncServiceImpl<StubDocumentService, StubSyncClient> {
    GithubSyncServiceImpl::new(
        GithubSyncConfig {
            webhook_secret: "test-webhook-secret".to_string(),
            github_sync_app_url: "test".to_string(),
            sync_app_pem: "test-sync-app-pem".to_string(),
            sync_app_client_id: "test-sync-app-client-id".to_string(),
        },
        Arc::new(StubDocumentService),
        StubSyncClient,
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
                "title": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51",
                "body": null,
                "head": { "ref": "feature/some-branch" }
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn pr_with_task_id_in_branch_name() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "opened",
            "pull_request": {
                "title": "some feature",
                "body": "no task ids here",
                "head": { "ref": "macro-2BuyvtY3aeEvHx4uG8iD51" }
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn issue_comment_with_task_id() {
    let service = make_sync_service();
    let event = ValidatedGithubWebhookEvent::new(
        "issue_comment".to_string(),
        serde_json::json!({
            "action": "created",
            "comment": {
                "body": "fixes MACRO-2BuyvtY3aeEvHx4uG8iD51"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
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
            "review": {
                "body": "Approved, relates to MACRO-2BuyvtY3aeEvHx4uG8iD51"
            }
        }),
    );

    let result = service.process_webhook_event(&event).await;
    assert!(result.is_ok());
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
