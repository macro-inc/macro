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

#[tokio::test]
async fn fixed_error_date_is_an_opt_in_wire_response() {
    let sqs = FakeSqs::start().await;
    sqs.set_outage(true);
    sqs.lock().fixed_date = Some("Mon, 21 Sep 2026 14:13:20 GMT".into());
    for _ in 0..2 {
        let response = reqwest::Client::new()
            .post(&sqs.url)
            .header("x-amz-target", "AmazonSQS.SendMessage")
            .json(&json!({"QueueUrl":sqs.queue_url("test"),"MessageBody":"test"}))
            .send()
            .await
            .expect("fake response");
        assert_eq!(response.status(), 500);
        assert_eq!(response.headers()["date"], "Mon, 21 Sep 2026 14:13:20 GMT");
    }
}
