use super::*;
use rdkafka::mocking::MockCluster;
use rdkafka::producer::FutureRecord;

struct TestConsumerGroup;

impl GroupName for TestConsumerGroup {
    const GROUP_NAME: &'static str = "consumer-group";
}

struct LatestConsumerGroup;

impl GroupName for LatestConsumerGroup {
    const GROUP_NAME: &'static str = "latest-group";
    const INITIAL_OFFSET: InitialOffset = InitialOffset::Latest;
}

#[test]
fn grouped_config_starts_new_partitions_where_the_group_asks() {
    let config = grouped_config::<LatestConsumerGroup>("broker:9092");

    assert_eq!(config.get("group.id"), Some("latest-group"));
    assert_eq!(config.get("auto.offset.reset"), Some("latest"));
}

#[test]
fn producer_config_uses_brokers_and_message_timeout() {
    let config = producer_config("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("message.timeout.ms"), Some(MESSAGE_TIMEOUT_MS));
    assert_eq!(config.get("enable.auto.commit"), None);
}

#[test]
fn grouped_config_uses_named_group_manual_commits_and_earliest_offsets() {
    let config = grouped_config::<TestConsumerGroup>("broker-a:9092,broker-b:9092");

    assert_eq!(
        config.get("bootstrap.servers"),
        Some("broker-a:9092,broker-b:9092")
    );
    assert_eq!(config.get("group.id"), Some("consumer-group"));
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("auto.offset.reset"), Some("earliest"));
}

#[test]
fn ungrouped_config_uses_unique_internal_groups_without_offset_storage() {
    let first = ungrouped_config("broker:9092");
    let second = ungrouped_config("broker:9092");
    let first_group = first.get("group.id").unwrap();
    let second_group = second.get("group.id").unwrap();

    assert!(first_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert!(second_group.starts_with(UNGROUPED_GROUP_PREFIX));
    assert_ne!(first_group, second_group);
    assert_eq!(first.get("enable.auto.commit"), Some("false"));
    assert_eq!(first.get("enable.auto.offset.store"), Some("false"));
    assert_eq!(first.get("auto.offset.reset"), None);
}

struct BoundedPrefetchGroup;

impl GroupName for BoundedPrefetchGroup {
    const GROUP_NAME: &'static str = "bounded-prefetch-group";
    const PREFETCH: Prefetch = Prefetch::Bounded {
        records: 10,
        partition_bytes: 8 * 1024,
    };
}

#[tokio::test]
async fn bounded_prefetch_keeps_a_quiet_partition_close_behind_a_backlog() {
    let cluster = MockCluster::new(1).expect("mock cluster");
    cluster
        .create_topic("backlog", 1, 1)
        .expect("backlog topic");
    cluster.create_topic("quiet", 1, 1).expect("quiet topic");
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", cluster.bootstrap_servers())
        .set("batch.num.messages", "10")
        .create()
        .expect("producer");
    let deliveries: Vec<_> = (0..2_000)
        .map(|_| {
            producer
                .send_result(FutureRecord::<(), _>::to("backlog").payload("backlog"))
                .expect("enqueue backlog record")
        })
        .collect();
    for delivery in deliveries {
        delivery
            .await
            .expect("delivery report")
            .expect("publish backlog record");
    }

    let consumer: StreamConsumer =
        grouped_config::<BoundedPrefetchGroup>(&cluster.bootstrap_servers())
            .create()
            .expect("consumer");
    let mut assignment = TopicPartitionList::new();
    assignment
        .add_partition_offset("backlog", 0, Offset::Beginning)
        .expect("backlog assignment");
    assignment
        .add_partition_offset("quiet", 0, Offset::Beginning)
        .expect("quiet assignment");
    consumer.assign(&assignment).expect("assign");

    // The quiet record is published once 50 backlog records have arrived. By
    // then librdkafka's defaults have fetched most of the backlog ahead of it,
    // so it arrives soon after only if the consumer stopped fetching early.
    let mut backlog_received = 0;
    loop {
        let message = tokio::time::timeout(Duration::from_secs(10), consumer.recv())
            .await
            .expect("receive deadline")
            .expect("message");
        if message.topic() == "quiet" {
            break;
        }
        backlog_received += 1;
        if backlog_received == 50 {
            producer
                .send(
                    FutureRecord::<(), _>::to("quiet").payload("quiet"),
                    SEND_TIMEOUT,
                )
                .await
                .expect("publish quiet record");
        }
    }

    assert!(
        backlog_received < 500,
        "{backlog_received} backlog records arrived before the quiet record"
    );
}
