use super::*;
use crate::domain::models::messages::ContactConnection;
use crate::trace_context::capture::Capture;
use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use macro_user_id::user_id::MacroUserIdStr;
use opentelemetry::trace::TraceContextExt as _;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use wiremock::matchers::{header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn queue(server: &MockServer) -> SqsContactsQueue {
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(server.uri())
        .retry_config(RetryConfig::disabled())
        .build();
    SqsContactsQueue::new(aws_sdk_sqs::Client::from_conf(config), server.uri())
}

fn connections() -> ContactConnections {
    let user = |email: &str| MacroUserIdStr::try_from_email(email).unwrap();
    ContactConnections::new(vec![ContactConnection::new(
        user("zeus@example.com"),
        user("apollo@example.com"),
    )])
}

async fn sent_attributes(server: &MockServer) -> serde_json::Value {
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    body["MessageAttributes"].clone()
}

async fn mock_send(server: &MockServer) {
    Mock::given(method("POST"))
        .and(header("x-amz-target", "AmazonSQS.SendMessage"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"MessageId": "m-0"})),
        )
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn a_message_carries_the_senders_traceparent() {
    let _capture = Capture::start();
    let server = MockServer::start().await;
    mock_send(&server).await;

    let send = tracing::info_span!(parent: None, "contacts.send");
    let trace_id = send.context().span().span_context().trace_id();
    queue(&server)
        .publish_connections(connections())
        .instrument(send)
        .await
        .unwrap();

    let traceparent = sent_attributes(&server).await[ATTRIBUTE]["StringValue"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(traceparent.contains(&trace_id.to_string()), "{traceparent}");
}

#[tokio::test]
async fn a_message_sent_outside_a_trace_has_no_attributes() {
    let server = MockServer::start().await;
    mock_send(&server).await;

    queue(&server)
        .publish_connections(connections())
        .await
        .unwrap();

    assert!(sent_attributes(&server).await.is_null());
}
