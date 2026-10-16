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
