use macro_event_broker::{KafkaEventPublisher, MacroEventBrokerService};
use rdkafka::{
    ClientConfig, Message, Offset, TopicPartitionList,
    consumer::{Consumer, StreamConsumer},
    mocking::MockCluster,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Duration;
use tokio_util::task::TaskTracker;

pub(super) struct Kafka {
    _cluster: MockCluster<'static, rdkafka::producer::DefaultProducerContext>,
    consumer: StreamConsumer,
    offsets: BTreeMap<(String, i32), i64>,
    pub tracker: TaskTracker,
    pub broker: MacroEventBrokerService<KafkaEventPublisher, TaskTracker>,
}

impl Kafka {
    pub fn start() -> Self {
        let cluster = MockCluster::new(1).expect("mock Kafka cluster");
        cluster
            .create_topic("macro.email", 1, 1)
            .expect("email topic");
        let consumer: StreamConsumer = ClientConfig::new()
            .set("bootstrap.servers", cluster.bootstrap_servers())
            .set("group.id", "parity")
            .set("enable.auto.commit", "false")
            .create()
            .expect("Kafka consumer");
        let mut assignment = TopicPartitionList::new();
        assignment
            .add_partition_offset("macro.email", 0, Offset::Beginning)
            .expect("partition");
        consumer.assign(&assignment).expect("assign consumer");
        let tracker = TaskTracker::new();
        let broker = MacroEventBrokerService::new(
            KafkaEventPublisher::with_environment(
                &cluster.bootstrap_servers(),
                macro_env::Environment::Local,
            )
            .expect("real Kafka publisher"),
            tracker.clone(),
        );
        Self {
            _cluster: cluster,
            consumer,
            offsets: BTreeMap::new(),
            tracker,
            broker,
        }
    }

    pub async fn take(&mut self) -> Vec<Value> {
        self.tracker.close();
        tokio::time::timeout(Duration::from_secs(15), self.tracker.wait())
            .await
            .expect("publishes drained");
        self.tracker.reopen();
        let metadata = self
            .consumer
            .fetch_metadata(None, Duration::from_secs(5))
            .expect("Kafka topic catalog");
        let mut assignment = TopicPartitionList::new();
        let mut count = 0;
        for topic in metadata.topics() {
            for partition in topic.partitions() {
                let key = (topic.name().to_owned(), partition.id());
                let (_, high) = self
                    .consumer
                    .fetch_watermarks(topic.name(), partition.id(), Duration::from_secs(5))
                    .expect("Kafka watermark");
                let previous = self.offsets.insert(key, high).unwrap_or(0);
                assignment
                    .add_partition_offset(topic.name(), partition.id(), Offset::Offset(previous))
                    .expect("Kafka partition offset");
                count += high - previous;
            }
        }
        self.consumer
            .assign(&assignment)
            .expect("Kafka step assignment");
        let mut messages = Vec::new();
        // This is a bounded read to the acknowledged broker watermark, not polling.
        for _ in 0..count {
            let message = tokio::time::timeout(Duration::from_secs(10), self.consumer.recv())
                .await
                .expect("Kafka receive signal")
                .expect("Kafka record");
            messages.push(json!({"topic": message.topic(),
                "key": message.key().map(|key| String::from_utf8_lossy(key)),
                "payload": serde_json::from_slice::<Value>(message.payload().expect("event payload")).expect("event JSON")}));
        }
        messages
    }
}
