use super::*;
use crate::outbound::test_support::mock_http;
use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use serde_json::{Value, json};

fn event(generation: u64) -> ImportEvent {
    ImportEvent {
        job_id: "01980000-0000-7000-8000-000000000001".parse().unwrap(),
        slack_channel_id: "C123".parse().unwrap(),
        generation,
    }
}

fn response(body: Value) -> String {
    let body = body.to_string();
    format!(
        "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/x-amz-json-1.0\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
}

fn client(endpoint: &str) -> Client {
    Client::from_conf(
        aws_sdk_sqs::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(Credentials::new("test", "test", None, None, "test"))
            .endpoint_url(endpoint)
            .retry_config(RetryConfig::disabled())
            .build(),
    )
}

async fn queue(endpoint: &str) -> SqsImportQueue {
    SqsImportQueue::new(
        client(endpoint),
        &SlackImportQueue::from_owned(format!("{endpoint}/main")),
        &SlackImportDlq::from_owned(format!("{endpoint}/dlq")),
    )
    .await
    .unwrap()
}

fn request_body(request: &str) -> Value {
    serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()
}

#[tokio::test]
async fn resolves_typed_names_at_startup() {
    let (endpoint, requests) = mock_http(vec![
        response(json!({"QueueUrl":"https://queue/main"})),
        response(json!({"QueueUrl":"https://queue/dlq"})),
    ]);
    let queue = SqsImportQueue::new(
        client(&endpoint),
        &SlackImportQueue::dev(),
        &SlackImportDlq::dev(),
    )
    .await
    .unwrap();
    assert_eq!(queue.main_url, "https://queue/main");
    assert_eq!(queue.dlq_url, "https://queue/dlq");
    assert_eq!(
        request_body(&requests.recv().unwrap())["QueueName"],
        "slack-import-queue-dev"
    );
    assert_eq!(
        request_body(&requests.recv().unwrap())["QueueName"],
        "slack-import-dlq-dev"
    );
}

#[tokio::test]
async fn partial_batch_success_only_acknowledges_accepted_events() {
    let (endpoint, requests) = mock_http(vec![response(json!({
        "Successful": [{"Id":"1", "MessageId":"m1", "MD5OfMessageBody":"unused"}],
        "Failed": [{"Id":"0", "Code":"ServiceUnavailable", "SenderFault":false}]
    }))]);
    let events = [event(1), event(2)];
    let result = queue(&endpoint).await.publish_batch(&events).await.unwrap();
    assert_eq!(result.published, vec![event(2)]);
    assert_eq!(result.failed.len(), 1);
    assert_eq!(result.failed[0].event, event(1));
    assert!(!result.failed[0].sender_fault);
    let body = request_body(&requests.recv().unwrap());
    assert_eq!(body["Entries"][0]["Id"], "0");
    let payload: Value =
        serde_json::from_str(body["Entries"][0]["MessageBody"].as_str().unwrap()).unwrap();
    assert_eq!(payload.as_object().unwrap().len(), 3);
    assert_eq!(payload, serde_json::to_value(event(1)).unwrap());
}

#[tokio::test]
async fn publication_rejects_failed_missing_duplicate_and_unknown_results() {
    for body in [
        json!({"Successful":[], "Failed":[{"Id":"0", "Code":"Invalid", "SenderFault":true}]}),
        json!({"Successful":[], "Failed":[]}),
        json!({"Successful":[{"Id":"9", "MessageId":"m", "MD5OfMessageBody":"x"}], "Failed":[]}),
        json!({"Successful":[{"Id":"0", "MessageId":"m", "MD5OfMessageBody":"x"}], "Failed":[{"Id":"0", "Code":"Invalid", "SenderFault":false}]}),
    ] {
        let (endpoint, _) = mock_http(vec![response(body)]);
        assert!(queue(&endpoint).await.publish(&event(1)).await.is_err());
    }
    let queue = queue("http://127.0.0.1:1").await;
    assert!(queue.publish_batch(&[]).await.is_err());
    assert!(queue.publish_batch(&vec![event(1); 11]).await.is_err());
}

#[tokio::test]
async fn long_poll_counts_visibility_and_ack_use_delivery_origin_including_dlq() {
    for source in [QueueSource::Main, QueueSource::DeadLetter] {
        let body = json!({"Messages": [
            {"MessageId":"m", "ReceiptHandle":"receipt", "Body":serde_json::to_string(&event(1)).unwrap(), "Attributes":{"ApproximateReceiveCount":"5"}},
            {"MessageId":"bad", "ReceiptHandle":"bad-receipt", "Body":"{\"key\":\"untrusted\"}", "Attributes":{"ApproximateReceiveCount":"1"}}
        ]});
        let (endpoint, requests) = mock_http(vec![
            response(body),
            response(json!({})),
            response(json!({})),
        ]);
        let queue = queue(&endpoint).await;
        let deliveries = queue.receive(source).await.unwrap();
        assert_eq!(deliveries.len(), 2);
        assert_eq!(deliveries[0].receive_count, 5);
        assert_eq!(deliveries[0].event, Ok(event(1)));
        assert_eq!(deliveries[1].event, Err(ImportError::InvalidInput));
        assert!(
            queue
                .extend_visibility(&deliveries[0], 43_201)
                .await
                .is_err()
        );
        queue.extend_visibility(&deliveries[0], 180).await.unwrap();
        queue.delete(&deliveries[0]).await.unwrap();
        let poll = request_body(&requests.recv().unwrap());
        assert_eq!(poll["WaitTimeSeconds"], 20);
        assert_eq!(poll["MaxNumberOfMessages"], 10);
        assert_eq!(poll["VisibilityTimeout"], 180);
        assert_eq!(
            poll["MessageSystemAttributeNames"],
            json!(["ApproximateReceiveCount"])
        );
        assert_eq!(poll["QueueUrl"], queue.url(source));
        let visibility = request_body(&requests.recv().unwrap());
        assert_eq!(visibility["QueueUrl"], queue.url(source));
        assert_eq!(visibility["VisibilityTimeout"], 180);
        assert_eq!(visibility["ReceiptHandle"], "receipt");
        let delete = request_body(&requests.recv().unwrap());
        assert_eq!(delete["QueueUrl"], queue.url(source));
        assert_eq!(delete["ReceiptHandle"], "receipt");
    }
}

#[test]
fn missing_receipt_or_receive_count_never_becomes_an_acknowledgeable_delivery() {
    assert!(delivery(QueueSource::Main, Message::builder().body("{}").build()).is_err());
    assert!(
        delivery(
            QueueSource::Main,
            Message::builder()
                .receipt_handle("receipt")
                .body("{}")
                .build()
        )
        .is_err()
    );
}
