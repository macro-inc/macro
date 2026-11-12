use super::*;

#[tokio::test]
async fn http_probe_does_not_poison_subsequent_sqs_requests() {
    let sqs = FakeSqs::start().await;
    let response = reqwest::get(&sqs.url).await.expect("probe response");
    assert_eq!(response.status().as_u16(), 405);

    client(&sqs.url, false)
        .send_message()
        .queue_url(sqs.queue_url("test"))
        .message_body("after probe")
        .send()
        .await
        .expect("SQS remains usable after a non-SQS request");
    let (sent, acks) = sqs.take();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].body, "after probe");
    assert!(acks.is_empty());
}
