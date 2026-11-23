use super::*;
use aws_sdk_sqs::types::Message;

fn sent_at(timestamp: &str) -> Message {
    Message::builder()
        .attributes(MessageSystemAttributeName::SentTimestamp, timestamp)
        .build()
}

#[test]
fn queue_wait_counts_from_when_sqs_accepted_the_message() {
    let now = UNIX_EPOCH + Duration::from_millis(1_700_000_090_500);

    assert_eq!(
        queue_wait(&sent_at("1700000000000"), now),
        Some(Duration::from_millis(90_500))
    );
}

#[test]
fn queue_wait_is_unknown_without_a_usable_sent_time() {
    let now = UNIX_EPOCH + Duration::from_millis(1_700_000_000_000);

    assert_eq!(queue_wait(&Message::builder().build(), now), None);
    assert_eq!(queue_wait(&sent_at("not-a-timestamp"), now), None);
    // A sender clock ahead of ours reads as no wait to report, not a huge one.
    assert_eq!(queue_wait(&sent_at("1700000005000"), now), None);
}
