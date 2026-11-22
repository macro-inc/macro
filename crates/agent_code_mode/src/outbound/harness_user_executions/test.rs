use super::*;
use crate::domain::ExecutionStatus;
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const USER: &str = "macro|mentioner@example.com";
const KEY: &str = "client-test-key";

fn mention() -> MentionContext {
    MentionContext {
        channel_id: None,
        message_id: uuid::Uuid::from_u128(1),
        root_id: uuid::Uuid::from_u128(2),
    }
}

fn program() -> ExecuteRequest {
    ExecuteRequest {
        source: "export async function main() { return {data: 1}; }".into(),
        timeout_ms: 5000,
    }
}

async fn run(server: &MockServer) -> Result<UserExecutionReceipt, CodeModeError> {
    HarnessUserExecutions::new(&server.uri(), KEY)
        .unwrap()
        .execute(
            &MacroUserIdStr::try_from(USER.to_string()).unwrap(),
            &mention(),
            program(),
            CancellationToken::new(),
        )
        .await
}

#[tokio::test]
async fn sends_the_user_and_mention_with_the_internal_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(USER_EXECUTIONS_PATH))
        .and(header(INTERNAL_API_KEY_HEADER, KEY))
        .and(body_json(json!({
            "userId": USER,
            "mention": {
                "messageId": uuid::Uuid::from_u128(1),
                "rootId": uuid::Uuid::from_u128(2),
            },
            "source": "export async function main() { return {data: 1}; }",
            "timeoutMs": 5000,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "succeeded",
            "activity": [],
            "activityTruncated": false,
            "result": {"data": 1},
            "error": null,
        })))
        .expect(1)
        .mount(&server)
        .await;
    let receipt = run(&server).await.unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.result, Some(json!({"data": 1})));
}

#[tokio::test]
async fn keeps_safe_failures_and_hides_the_rest() {
    for (status, body, expected) in [
        (503, json!({"error": "busy"}), "busy"),
        (
            400,
            json!({"error": "invalid", "message": "too long"}),
            "too long",
        ),
        // A failure envelope that disagrees with its status is not trusted.
        (
            500,
            json!({"error": "invalid", "message": "spoofed"}),
            "outcome was lost",
        ),
        (500, json!({"error": "failed"}), "outcome was lost"),
        (502, json!({"upstream": "html"}), "outcome was lost"),
        (404, json!({}), "not configured"),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&server)
            .await;
        let error = run(&server).await.err().unwrap();
        assert!(error.to_string().contains(expected), "{status}: {error}");
    }
}

#[tokio::test]
async fn a_receipt_with_two_full_images_fits_and_a_larger_one_is_unconfirmed() {
    // About the size of two canvas renders at the harness's per-image cap.
    let fits = "a".repeat(MAX_RESULT_IMAGES * MAX_IMAGE_BASE64_BYTES);
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(USER_EXECUTIONS_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "succeeded",
            "activity": [],
            "activityTruncated": false,
            "result": {"data": fits},
            "error": null,
        })))
        .mount(&server)
        .await;
    assert_eq!(
        run(&server).await.unwrap().status,
        ExecutionStatus::Succeeded
    );

    let too_large = "a".repeat(MAX_RESPONSE_BYTES + 1);
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(USER_EXECUTIONS_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "succeeded",
            "activity": [],
            "activityTruncated": false,
            "result": {"data": too_large},
            "error": null,
        })))
        .mount(&server)
        .await;
    assert!(matches!(
        run(&server).await,
        Err(CodeModeError::Unconfirmed)
    ));
}
