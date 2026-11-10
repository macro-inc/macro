use super::PausedClock;

#[tokio::test]
async fn socket_io_does_not_advance_the_paused_clock() {
    let sqs = crate::pubsub::label_write_sim::fake_sqs::FakeSqs::start().await;
    let client = crate::pubsub::label_write_sim::fake_sqs::client(&sqs.url, false);
    let clock = PausedClock::start().await;
    let started = tokio::time::Instant::now();
    client
        .receive_message()
        .queue_url(sqs.queue_url("clock"))
        .send()
        .await
        .expect("real socket round trip");
    assert_eq!(tokio::time::Instant::now(), started);
    clock.advance(std::time::Duration::from_secs(20)).await;
    assert_eq!(
        tokio::time::Instant::now() - started,
        std::time::Duration::from_secs(20)
    );
}
