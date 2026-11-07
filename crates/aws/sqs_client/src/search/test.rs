use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method},
};

use super::*;
use crate::search::call::CallRecordMessage;

fn client(endpoint: &str) -> sqs::Client {
    sqs::Client::from_conf(
        sqs::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(Credentials::new("test", "test", None, None, "test"))
            .endpoint_url(endpoint)
            .retry_config(RetryConfig::disabled())
            .build(),
    )
}

fn call(id: &str) -> SearchQueueMessage {
    SearchQueueMessage::CallRecord(CallRecordMessage {
        call_id: id.to_owned(),
        index_override: None,
    })
}

fn batch_send() -> wiremock::MockBuilder {
    Mock::given(method("POST")).and(header("x-amz-target", "AmazonSQS.SendMessageBatch"))
}

fn batch_answer(body: serde_json::Value) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("content-type", "application/x-amz-json-1.0")
        .set_body_string(body.to_string())
}

fn entry_ids(request: &wiremock::Request) -> Vec<String> {
    let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
    body["Entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["Id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn an_entry_sqs_keeps_refusing_is_resent_then_returned() {
    let server = MockServer::start().await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [{"Id": "call-1", "MessageId": "m1", "MD5OfMessageBody": "unused"}],
            "Failed": [{"Id": "call-2", "Code": "ServiceUnavailable", "SenderFault": false}]
        })))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [],
            "Failed": [{"Id": "call-2", "Code": "ServiceUnavailable", "SenderFault": false}]
        })))
        .mount(&server)
        .await;

    let unqueued = bulk_enqueue_search_text_extractor(
        &client(&server.uri()),
        &format!("{}/queue", server.uri()),
        vec![call("call-1"), call("call-2")],
    )
    .await
    .unwrap();

    assert_eq!(
        unqueued,
        [UnqueuedEntry {
            id: "call-2".to_owned(),
            code: "ServiceUnavailable".to_owned(),
            sender_fault: false,
        }]
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests.iter().map(entry_ids).collect::<Vec<_>>(),
        [
            vec!["call-1".to_owned(), "call-2".to_owned()],
            vec!["call-2".to_owned()],
            vec!["call-2".to_owned()],
        ],
        "only the refused entry is sent again"
    );
}

#[tokio::test]
async fn an_entry_sqs_blames_on_the_sender_is_not_resent() {
    let server = MockServer::start().await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [],
            "Failed": [{"Id": "call-1", "Code": "InvalidParameterValue", "SenderFault": true}]
        })))
        .mount(&server)
        .await;

    let unqueued = bulk_enqueue_search_text_extractor(
        &client(&server.uri()),
        &format!("{}/queue", server.uri()),
        vec![call("call-1")],
    )
    .await
    .unwrap();

    assert_eq!(unqueued.len(), 1);
    assert!(unqueued[0].sender_fault);
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn an_entry_accepted_on_its_resend_is_queued() {
    let server = MockServer::start().await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [{"Id": "call-1", "MessageId": "m1", "MD5OfMessageBody": "unused"}],
            "Failed": [{"Id": "call-2", "Code": "InternalError", "SenderFault": false}]
        })))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [{"Id": "call-2", "MessageId": "m2", "MD5OfMessageBody": "unused"}],
            "Failed": []
        })))
        .mount(&server)
        .await;

    let unqueued = bulk_enqueue_search_text_extractor(
        &client(&server.uri()),
        &format!("{}/queue", server.uri()),
        vec![call("call-1"), call("call-2")],
    )
    .await
    .unwrap();

    assert!(unqueued.is_empty(), "{unqueued:?}");
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests.iter().map(entry_ids).collect::<Vec<_>>(),
        [
            vec!["call-1".to_owned(), "call-2".to_owned()],
            vec!["call-2".to_owned()],
        ],
        "the accepted entry is not sent again"
    );
}

#[tokio::test]
async fn only_the_entries_sqs_can_still_take_are_resent() {
    let server = MockServer::start().await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [],
            "Failed": [
                {"Id": "call-1", "Code": "InvalidParameterValue", "SenderFault": true},
                {"Id": "call-2", "Code": "InternalError", "SenderFault": false}
            ]
        })))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    batch_send()
        .respond_with(batch_answer(serde_json::json!({
            "Successful": [{"Id": "call-2", "MessageId": "m2", "MD5OfMessageBody": "unused"}],
            "Failed": []
        })))
        .mount(&server)
        .await;

    let unqueued = bulk_enqueue_search_text_extractor(
        &client(&server.uri()),
        &format!("{}/queue", server.uri()),
        vec![call("call-1"), call("call-2")],
    )
    .await
    .unwrap();

    assert_eq!(
        unqueued
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["call-1"]
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests.iter().map(entry_ids).collect::<Vec<_>>()[1],
        ["call-2"]
    );
}
