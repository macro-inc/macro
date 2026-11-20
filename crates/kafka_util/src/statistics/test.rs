use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

use rdkafka::{
    ClientConfig,
    consumer::{Consumer, DefaultConsumerContext, StreamConsumer},
    mocking::MockCluster,
    producer::{FutureProducer, FutureRecord},
    statistics::Statistics,
};

#[test]
fn observer_receives_statistics_once_without_default_payload_logging() {
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let context = StatisticsContext {
        inner: DefaultConsumerContext,
        offset_resets: offset_resets_counter(),
        observer: Some(Arc::new(move |stats| {
            assert_eq!(stats.rxmsgs, 12);
            observed.fetch_add(1, Ordering::SeqCst);
        })),
    };
    context.stats(Statistics {
        rxmsgs: 12,
        ..Default::default()
    });
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

struct AuthContext;
impl ClientContext for AuthContext {
    const ENABLE_REFRESH_OAUTH_TOKEN: bool = true;
    fn generate_oauth_token(
        &self,
        config: Option<&str>,
    ) -> Result<OAuthToken, Box<dyn std::error::Error>> {
        assert_eq!(config, Some("test-config"));
        Ok(OAuthToken {
            token: "test-only".into(),
            principal_name: "test-principal".into(),
            lifetime_ms: 123,
        })
    }
}

#[test]
fn wrapping_statistics_preserves_iam_token_refresh() {
    assert!(StatisticsContext::<AuthContext>::ENABLE_REFRESH_OAUTH_TOKEN);
    assert!(!StatisticsContext::<DefaultConsumerContext>::ENABLE_REFRESH_OAUTH_TOKEN);
    let context = StatisticsContext {
        inner: AuthContext,
        offset_resets: offset_resets_counter(),
        observer: None,
    };
    let token = context
        .generate_oauth_token(Some("test-config"))
        .expect("forwarded auth callback");
    assert_eq!(token.principal_name, "test-principal");
    assert_eq!(token.lifetime_ms, 123);
}

#[tokio::test]
async fn ungrouped_consumer_reports_application_offsets_without_commits() {
    let cluster = MockCluster::new(1).expect("mock broker");
    cluster.create_topic("stats-test", 1, 1).expect("topic");
    let (send, receive) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(send));
    let observer: ConsumerStatistics = Arc::new(move |stats| {
        let Some(partition) = stats
            .topics
            .get("stats-test")
            .and_then(|t| t.partitions.get(&0))
        else {
            return;
        };
        if partition.app_offset == 1 && partition.hi_offset >= 1 {
            if let Some(sender) = sender.lock().expect("sender mutex").take() {
                let broker_connected = stats
                    .brokers
                    .values()
                    .any(|broker| broker.nodeid == partition.broker && broker.state == "UP");
                sender
                    .send((partition.clone(), broker_connected))
                    .expect("live receiver");
            }
        }
    });
    let mut config = crate::ungrouped_config(&cluster.bootstrap_servers());
    config.set("statistics.interval.ms", "10");
    assert_eq!(config.get("enable.auto.commit"), Some("false"));
    assert_eq!(config.get("enable.auto.offset.store"), Some("false"));
    let consumer: StreamConsumer<_> = config
        .create_with_context(StatisticsContext {
            inner: DefaultConsumerContext,
            offset_resets: offset_resets_counter(),
            observer: Some(observer),
        })
        .expect("consumer");
    let mut assignment = rdkafka::TopicPartitionList::new();
    assignment
        .add_partition_offset("stats-test", 0, rdkafka::Offset::Beginning)
        .expect("assignment");
    consumer.assign(&assignment).expect("manual assignment");
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", cluster.bootstrap_servers())
        .create()
        .expect("producer");
    producer
        .send(
            FutureRecord::to("stats-test").key("test").payload("test"),
            std::time::Duration::from_secs(5),
        )
        .await
        .expect("publish");
    drop(
        tokio::time::timeout(std::time::Duration::from_secs(5), consumer.recv())
            .await
            .expect("receive deadline")
            .expect("message"),
    );

    // Polling services callbacks even while no records are being published.
    let (sample, broker_connected) =
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::select! {
                sample = receive => sample.expect("statistics callback"),
                _ = consumer.recv() => panic!("no second record was published"),
            }
        })
        .await
        .expect("statistics deadline");
    assert_eq!(sample.app_offset, 1);
    assert_eq!(sample.hi_offset, 1);
    assert!(
        sample.desired,
        "manual assignments must appear in health snapshots"
    );
    assert!(
        broker_connected,
        "the snapshot must identify its active broker"
    );
    assert!(
        sample.committed_offset < 0,
        "no durable offset was committed"
    );
}

/// librdkafka's out-of-range reset warning, as `rd_kafka_offset_reset`
/// formats it.
const OUT_OF_RANGE: &str = "[thrd:main]: macro.email [3]: offset reset (at offset 1200 (leader epoch 7), broker 2) to offset END: fetch failed due to requested offset not available on the broker: Broker: Offset out of range";

#[test]
fn an_offset_reset_warning_names_its_topic() {
    assert_eq!(reset_topic(OUT_OF_RANGE), Some("macro.email"));
    assert_eq!(
        reset_topic("macro.email [3]: offset reset"),
        Some("macro.email")
    );
    assert_eq!(
        reset_topic("Group search-processing-service OffsetFetchRequest"),
        None
    );
}

#[test]
fn only_offset_reset_warnings_are_counted_by_topic() {
    use opentelemetry::metrics::MeterProvider as _;
    use opentelemetry_sdk::metrics::{
        InMemoryMetricExporter, SdkMeterProvider,
        data::{AggregatedMetrics, MetricData},
    };

    let exporter = InMemoryMetricExporter::default();
    let provider = SdkMeterProvider::builder()
        .with_periodic_exporter(exporter.clone())
        .build();
    let context = StatisticsContext {
        inner: DefaultConsumerContext,
        observer: None,
        offset_resets: provider.meter("test").u64_counter(OFFSET_RESETS).build(),
    };

    context.log(RDKafkaLogLevel::Warning, OFFSET_FACILITY, OUT_OF_RANGE);
    context.log(RDKafkaLogLevel::Warning, OFFSET_FACILITY, OUT_OF_RANGE);
    context.log(RDKafkaLogLevel::Debug, OFFSET_FACILITY, OUT_OF_RANGE);
    context.log(RDKafkaLogLevel::Warning, "MAXPOLL", "leaving group");

    provider.force_flush().expect("metrics flush");
    let exported = exporter.get_finished_metrics().expect("exported metrics");
    let metric = exported
        .iter()
        .flat_map(|resource| resource.scope_metrics())
        .flat_map(|scope| scope.metrics())
        .find(|metric| metric.name() == OFFSET_RESETS)
        .expect("resets were counted");
    let AggregatedMetrics::U64(MetricData::Sum(sum)) = metric.data() else {
        panic!("a u64 counter; got {:?}", metric.data());
    };
    let points: Vec<_> = sum
        .data_points()
        .map(|point| {
            (
                point
                    .attributes()
                    .map(|attribute| format!("{}={}", attribute.key, attribute.value))
                    .collect::<Vec<_>>(),
                point.value(),
            )
        })
        .collect();
    assert_eq!(points, [(vec!["topic=macro.email".to_owned()], 2)]);
}

/// A consumer with no traffic keeps sampling while its loop waits in `recv`,
/// and stops once nothing polls it: a fresh sample means the loop is alive.
#[tokio::test]
async fn statistics_keep_arriving_while_idle_and_stop_without_polling() {
    let cluster = MockCluster::new(1).expect("mock broker");
    cluster.create_topic("idle-stats", 1, 1).expect("topic");
    let samples = Arc::new(AtomicUsize::new(0));
    let observer: ConsumerStatistics = Arc::new({
        let samples = Arc::clone(&samples);
        move |_| {
            samples.fetch_add(1, Ordering::SeqCst);
        }
    });
    let mut config = crate::ungrouped_config(&cluster.bootstrap_servers());
    config.set("statistics.interval.ms", "50");
    let consumer: StreamConsumer<_> = config
        .create_with_context(StatisticsContext {
            inner: DefaultConsumerContext,
            offset_resets: offset_resets_counter(),
            observer: Some(observer),
        })
        .expect("consumer");
    let mut assignment = rdkafka::TopicPartitionList::new();
    assignment
        .add_partition_offset("idle-stats", 0, rdkafka::Offset::End)
        .expect("assignment");
    consumer.assign(&assignment).expect("manual assignment");

    // librdkafka samples on its own thread, so this waits in real time; ten
    // 50 ms intervals each way are enough to tell samples from none.
    let idle = std::time::Duration::from_millis(500);
    assert!(
        tokio::time::timeout(idle, consumer.recv()).await.is_err(),
        "nothing was published"
    );
    let while_polling = samples.load(Ordering::SeqCst);
    assert!(
        while_polling >= 5,
        "an idle recv kept sampling: {while_polling} samples in {idle:?}"
    );

    tokio::time::sleep(idle).await;
    let without_polling = samples.load(Ordering::SeqCst) - while_polling;
    assert_eq!(without_polling, 0, "samples need a polling loop");
}
