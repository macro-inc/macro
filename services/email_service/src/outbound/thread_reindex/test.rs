use super::*;
use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use std::collections::BTreeSet;
use wiremock::{
    Mock, MockServer, Request, ResponseTemplate,
    matchers::{header, method},
};

fn sqs(server: &MockServer) -> SQS {
    SQS::new(aws_sdk_sqs::Client::from_conf(
        aws_sdk_sqs::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(Credentials::new("test", "test", None, None, "test"))
            .endpoint_url(server.uri())
            .retry_config(RetryConfig::disabled())
            .build(),
    ))
    .search_event_queue("search-event-queue")
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
}

fn threads(count: u128) -> Vec<Uuid> {
    (0..count).map(Uuid::from_u128).collect()
}

fn sends() -> wiremock::MockBuilder {
    Mock::given(method("POST")).and(header("x-amz-target", "AmazonSQS.SendMessage"))
}

fn accepted() -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("content-type", "application/x-amz-json-1.0")
        .set_body_string(
            serde_json::json!({"MessageId": "m", "MD5OfMessageBody": "unused"}).to_string(),
        )
}

async fn sent(server: &MockServer) -> Vec<Request> {
    server.received_requests().await.unwrap()
}

/// The threads are queued for the bulk workers in the batches the reindex
/// events use, every thread once, and no worker reads them for a minute: the
/// caller's own change is stored right after.
#[tokio::test]
async fn threads_are_queued_in_batches_that_wait_for_the_callers_change() {
    let server = MockServer::start().await;
    sends().respond_with(accepted()).mount(&server).await;

    enqueue(&sqs(&server), &owner(), threads(120))
        .await
        .unwrap();

    let requests = sent(&server).await;
    let mut sizes = Vec::new();
    let mut queued = BTreeSet::new();
    for request in &requests {
        let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
        assert_eq!(body["DelaySeconds"], 60);
        let message: serde_json::Value =
            serde_json::from_str(body["MessageBody"].as_str().unwrap()).unwrap();
        let batch = &message["ExtractEmailThreadBatch"];
        assert_eq!(batch["macro_user_id"], "macro|owner@example.com");
        assert!(batch.get("index_override").is_none());
        let ids = batch["thread_ids"].as_array().unwrap();
        sizes.push(ids.len());
        for id in ids {
            assert!(queued.insert(id.as_str().unwrap().to_owned()));
        }
    }
    sizes.sort_unstable();
    assert_eq!(sizes, vec![20, 50, 50]);
    assert_eq!(
        queued,
        threads(120)
            .iter()
            .map(Uuid::to_string)
            .collect::<BTreeSet<_>>()
    );
}

/// A refused send fails the call, so the caller keeps the rename to retry.
#[tokio::test]
async fn a_refused_send_fails_the_call() {
    let server = MockServer::start().await;
    sends()
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;

    enqueue(&sqs(&server), &owner(), threads(1))
        .await
        .unwrap_err();
}
