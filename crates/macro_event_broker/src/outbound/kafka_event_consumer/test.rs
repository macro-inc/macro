use kafka_util::Ungrouped;

use super::*;
use crate::{EventBrokerError, MessageParts};

struct TestEvents;

impl MacroEventCollection for TestEvents {
    fn decode<T: MessageParts>(_message: &T) -> Result<Self, EventBrokerError> {
        unreachable!("compile-time adapter assertion does not decode messages")
    }

    fn topics() -> &'static [&'static str] {
        &[]
    }
}

fn assert_event_consumer<T: EventConsumer<TestEvents>>() {}

#[test]
fn kafka_adapter_implements_event_consumer_port() {
    assert_event_consumer::<KafkaConsumerAdapter<Ungrouped, TestEvents>>();
}
