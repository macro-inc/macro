//! The harness's own levers, checked against the real services.

use email_e2e::redis::AsyncCommands;
use email_e2e::{DEFAULT_TIMEOUT, Report, Stack, eventually};

/// A stand-in told to fail answers the error once, records the request, and
/// answers normally afterwards.
#[tokio::test(flavor = "multi_thread")]
async fn stand_in_answers_an_error_once() -> Result<(), Report> {
    let stack = Stack::start().await?;
    stack.fail_next_service_request("document-storage", "POST", "/documents", 404)?;

    let http = reqwest::Client::new();
    let url = format!("{}/documents/import", stack.service_url("document-storage"));
    let refused = http.post(&url).json(&serde_json::json!({})).send().await?;
    assert_eq!(refused.status(), 404);
    let answered = http.post(&url).json(&serde_json::json!({})).send().await?;
    assert_eq!(answered.status(), 200);
    assert_eq!(stack.service_requests().len(), 2);

    stack.finish().await
}

/// The scenario reaches the Redis database the services use.
#[tokio::test(flavor = "multi_thread")]
async fn redis_is_the_services_database() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    ada.link_gmail().await?;

    let mut redis = stack.redis().await?;
    eventually(
        "the services to write to Redis",
        DEFAULT_TIMEOUT,
        async || {
            let keys: Vec<String> = redis.keys("*").await?;
            Ok((!keys.is_empty()).then_some(()))
        },
    )
    .await?;

    stack.finish().await
}
