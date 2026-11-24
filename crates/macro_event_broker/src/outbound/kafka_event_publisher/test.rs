use super::*;

#[test]
fn only_a_message_over_the_size_limit_is_too_large() {
    let refused = |code| publish_error(KafkaError::MessageProduction(code));

    assert!(matches!(
        refused(RDKafkaErrorCode::MessageSizeTooLarge),
        EventBrokerError::TooLarge(_)
    ));
    for code in [
        RDKafkaErrorCode::QueueFull,
        RDKafkaErrorCode::MessageTimedOut,
        RDKafkaErrorCode::UnknownTopicOrPartition,
    ] {
        assert!(matches!(refused(code), EventBrokerError::Publish(_)));
    }
}
