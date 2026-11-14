use super::*;

#[test]
fn the_receive_count_is_read_from_the_message_and_counts_this_delivery() {
    let redelivered = aws_sdk_sqs::types::Message::builder()
        .attributes(MessageSystemAttributeName::ApproximateReceiveCount, "7")
        .build();
    let unknown = aws_sdk_sqs::types::Message::builder().build();

    assert_eq!(receive_count(&redelivered), 7);
    assert_eq!(receive_count(&unknown), 1);
}
