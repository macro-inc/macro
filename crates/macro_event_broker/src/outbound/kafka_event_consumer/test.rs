use kafka_util::{GroupName, Ungrouped};

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

struct TestConsumerGroup;

impl GroupName for TestConsumerGroup {
    const GROUP_NAME: &'static str = "test-consumer-group";
}

fn assert_event_consumer<T: EventConsumer<TestEvents>>() {}

#[test]
fn kafka_adapter_implements_event_consumer_port() {
    assert_event_consumer::<KafkaConsumerAdapter<Ungrouped, TestEvents>>();
}

#[test]
fn grouped_adapter_exposes_parallel_transport_primitives() {
    let assertion = |adapter: &KafkaConsumerAdapter<TestConsumerGroup, TestEvents>| {
        let _ = adapter.commit_partition_offset("events", 0, 1, CommitMode::Async);
        let _ = adapter.pause_current_assignment();
        let _ = adapter.resume_current_assignment();
        let _ = adapter.rebalance_tracker();
    };

    let _ = assertion;
}
