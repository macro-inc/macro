use super::*;

#[test]
fn the_deferral_count_is_read_from_the_message() {
    let deferred = aws_sdk_sqs::types::Message::builder()
        .message_attributes(
            BACKFILL_DEFERRALS_ATTRIBUTE,
            aws_sdk_sqs::types::MessageAttributeValue::builder()
                .data_type("Number")
                .string_value("4")
                .build()
                .unwrap(),
        )
        .build();
    let fresh = aws_sdk_sqs::types::Message::builder().build();

    assert_eq!(deferrals(&deferred), 4);
    assert_eq!(deferrals(&fresh), 0);
}
