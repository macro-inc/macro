use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use serde_json::{Value, json};
use wiremock::matchers::{header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

async fn queue_answering_batches_with(response: Value) -> (MockServer, aws_sdk_sqs::Client) {
    let server = MockServer::start().await;
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(server.uri())
        .retry_config(RetryConfig::disabled())
        .build();
    Mock::given(method("POST"))
        .and(header("x-amz-target", "AmazonSQS.SendMessageBatch"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .expect(1)
        .mount(&server)
        .await;
    (server, aws_sdk_sqs::Client::from_conf(config))
}

#[tokio::test]
async fn bulk_enqueue_document_delete_fails_when_sqs_rejects_an_entry() {
    let (server, client) = queue_answering_batches_with(json!({
        "Successful": [
            { "Id": "document-one", "MessageId": "message-one", "MD5OfMessageBody": "digest" }
        ],
        "Failed": [
            {
                "Id": "document-two",
                "SenderFault": false,
                "Code": "InternalError",
                "Message": "try again"
            }
        ]
    }))
    .await;

    let error = bulk_enqueue_document_delete(
        &client,
        &server.uri(),
        vec!["document-one".to_string(), "document-two".to_string()],
    )
    .await
    .expect_err("a rejected entry should fail the enqueue");

    assert_eq!(
        error.to_string(),
        "SQS rejected 1 of 2 document delete messages: InternalError"
    );
}

#[tokio::test]
async fn bulk_enqueue_document_delete_succeeds_when_sqs_accepts_every_entry() {
    let (server, client) = queue_answering_batches_with(json!({
        "Successful": [
            { "Id": "document-one", "MessageId": "message-one", "MD5OfMessageBody": "digest" },
            { "Id": "document-two", "MessageId": "message-two", "MD5OfMessageBody": "digest" }
        ],
        "Failed": []
    }))
    .await;

    bulk_enqueue_document_delete(
        &client,
        &server.uri(),
        vec!["document-one".to_string(), "document-two".to_string()],
    )
    .await
    .unwrap();
}
