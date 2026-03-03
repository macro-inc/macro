use crate::domain::{models::ValidatedGithubWebhookEvent, ports::GithubSyncService};

use super::*;

fn make_sync_service() -> GithubSyncServiceImpl {
    GithubSyncServiceImpl::new(GithubSyncConfig {
        webhook_secret: "test-webhook-secret".to_string(),
        github_sync_app_url: "test".to_string(),
        sync_app_pem: "test-sync-app-pem".to_string(),
        sync_app_client_id: "test-sync-app-client-id".to_string(),
    })
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
