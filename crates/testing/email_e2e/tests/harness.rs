//! The harness's own levers, checked against the real services.

use email_e2e::redis::AsyncCommands;
use email_e2e::{DEFAULT_TIMEOUT, Report, Stack, StackOptions, eventually};

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

    let code = serde_json::json!({ "code": "NOT_FOUND" });
    stack.fail_next_service_request_with("document-storage", "POST", "/documents", 410, &code)?;
    let refused = http.post(&url).json(&serde_json::json!({})).send().await?;
    assert_eq!(refused.status(), 410);
    assert_eq!(refused.json::<serde_json::Value>().await?, code);
    let staff = stack.user_at("ada@macro.com").await?;
    assert_eq!(staff.email(), "ada@macro.com");
    let answered = http.post(&url).json(&serde_json::json!({})).send().await?;
    assert_eq!(answered.status(), 200);
    assert_eq!(stack.service_requests().len(), 3);

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

/// The real scheduled-send sweep runs against the scenario's database and
/// queues and finishes.
#[tokio::test(flavor = "multi_thread")]
async fn scheduled_sweep_runs() -> Result<(), Report> {
    let stack = Stack::start().await?;
    stack.run_scheduled_sweep().await?;
    assert!(stack.take_queue_messages("scheduled").await?.is_empty());
    stack.finish().await
}

/// A stack asked for it serves the GraphQL API on the scenario's data: a
/// user reads their own id through it.
#[tokio::test(flavor = "multi_thread")]
async fn graphql_answers_as_the_user() -> Result<(), Report> {
    let stack = Stack::start_with(StackOptions {
        document_storage: true,
        ..StackOptions::default()
    })
    .await?;
    let ada = stack.user("ada").await?;

    let data = ada
        .graphql("query { user { id } }", &serde_json::json!({}))
        .await?;
    assert_eq!(data["user"]["id"], ada.macro_id(), "{data}");

    stack.finish().await
}
