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
fn consumers_log_at_least_warnings_so_offset_resets_reach_their_context() {
    let config = consumer_config("broker:9092");

    assert!(config.log_level as i32 >= RDKafkaLogLevel::Warning as i32);
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

#[tokio::test]
async fn position_and_cached_watermarks_show_records_not_yet_received() {
    use rdkafka::mocking::MockCluster;
    use rdkafka::producer::{FutureProducer, FutureRecord};

    let cluster = MockCluster::new(1).expect("mock broker");
    cluster.create_topic("position-test", 1, 1).expect("topic");
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", cluster.bootstrap_servers())
        .create()
        .expect("producer");
    for _ in 0..3 {
        producer
            .send(
                FutureRecord::to("position-test")
                    .key("key")
                    .payload("payload"),
                Duration::from_secs(5),
            )
            .await
            .expect("publish");
    }
    let consumer: StreamConsumer<_> =
        grouped_config::<TestConsumerGroup>(&cluster.bootstrap_servers())
            .create_with_context(StatisticsContext {
                inner: DefaultConsumerContext,
                observer: None,
                offset_resets: statistics::offset_resets_counter(),
            })
            .expect("consumer");
    let mut assignment = TopicPartitionList::new();
    assignment
        .add_partition_offset("position-test", 0, Offset::Beginning)
        .expect("assignment");
    consumer.assign(&assignment).expect("manual assignment");
    let consumer = KafkaEventConsumer::<TestConsumerGroup> {
        consumer: ConsumerTransport(Either::Left(consumer)),
        marker: PhantomData,
    };

    let before = consumer.position().expect("position");
    assert_eq!(
        before
            .find_partition("position-test", 0)
            .map(|partition| partition.offset()),
        Some(Offset::Invalid),
        "nothing received yet"
    );
    drop(
        tokio::time::timeout(Duration::from_secs(5), consumer.recv())
            .await
            .expect("receive deadline")
            .expect("message"),
    );

    let after = consumer.position().expect("position");
    assert_eq!(
        after
            .find_partition("position-test", 0)
            .map(|partition| partition.offset()),
        Some(Offset::Offset(1))
    );
    let (_, high) = consumer
        .cached_watermarks("position-test", 0)
        .expect("watermarks");
    assert_eq!(high, 3, "two fetched records are still unreceived");
}

/// Records the librdkafka log lines a consumer forwards to its inner context,
/// and signals the first offset reset.
#[derive(Default)]
struct LogRecorder {
    lines: std::sync::Mutex<Vec<(String, String)>>,
    reset: tokio::sync::Notify,
}

impl rdkafka::client::ClientContext for LogRecorder {
    fn log(&self, _level: rdkafka::config::RDKafkaLogLevel, facility: &str, message: &str) {
        self.lines
            .lock()
            .expect("log lock")
            .push((facility.to_owned(), message.to_owned()));
        if facility == "OFFSET" {
            self.reset.notify_one();
        }
    }
}

impl ConsumerContext for LogRecorder {}

#[tokio::test]
async fn a_position_past_the_log_is_reset_and_counted() {
    use opentelemetry::metrics::MeterProvider as _;
    use opentelemetry_sdk::metrics::{
        InMemoryMetricExporter, SdkMeterProvider,
        data::{AggregatedMetrics, MetricData},
    };
    use rdkafka::mocking::MockCluster;
    use rdkafka::producer::{FutureProducer, FutureRecord};

    let cluster = MockCluster::new(1).expect("mock broker");
    cluster.create_topic("reset-test", 1, 1).expect("topic");
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", cluster.bootstrap_servers())
        .create()
        .expect("producer");
    producer
        .send(
            FutureRecord::to("reset-test").key("key").payload("payload"),
            Duration::from_secs(5),
        )
        .await
        .expect("publish");
    let exporter = InMemoryMetricExporter::default();
    let provider = SdkMeterProvider::builder()
        .with_periodic_exporter(exporter.clone())
        .build();
    let consumer: StreamConsumer<_> =
        grouped_config::<TestConsumerGroup>(&cluster.bootstrap_servers())
            .create_with_context(StatisticsContext {
                inner: LogRecorder::default(),
                observer: None,
                offset_resets: provider
                    .meter("test")
                    .u64_counter("kafka.consumer.offset_resets")
                    .build(),
            })
            .expect("consumer");
    let mut assignment = TopicPartitionList::new();
    assignment
        .add_partition_offset("reset-test", 0, Offset::Offset(1_000))
        .expect("assignment");
    consumer.assign(&assignment).expect("manual assignment");

    // The fetch at 1000 fails out of range and librdkafka resets the
    // partition; receiving serves the log callback that counts it.
    let recorder = &consumer.context().inner;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            tokio::select! {
                () = recorder.reset.notified() => break,
                _ = consumer.recv() => {}
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "no offset reset was logged: {:?}",
            recorder.lines.lock().expect("log lock")
        )
    });

    provider.force_flush().expect("metrics flush");
    let counted: u64 = exporter
        .get_finished_metrics()
        .expect("exported metrics")
        .iter()
        .flat_map(|resource| resource.scope_metrics())
        .flat_map(|scope| scope.metrics())
        .filter(|metric| metric.name() == "kafka.consumer.offset_resets")
        .filter_map(|metric| match metric.data() {
            AggregatedMetrics::U64(MetricData::Sum(sum)) => {
                Some(sum.data_points().map(|point| point.value()).sum::<u64>())
            }
            _ => None,
        })
        .sum();
    assert_eq!(counted, 1);
    assert!(
        recorder
            .lines
            .lock()
            .expect("log lock")
            .iter()
            .any(|(facility, message)| facility == "OFFSET"
                && message.contains("reset-test [0]: offset reset")),
        "the warning still reaches the inner context"
    );
}
