use std::collections::BTreeMap;

use macro_event_broker::MacroEventCollection as _;
use opentelemetry::metrics::MeterProvider as _;
use opentelemetry_sdk::metrics::{
    InMemoryMetricExporter, SdkMeterProvider,
    data::{AggregatedMetrics, MetricData},
};

use super::*;
use crate::inbound::kafka_consumer::DeclaredMacroEvent;

/// Instruments on a provider whose exports [`Exported::read`] returns.
pub(in crate::inbound::kafka_consumer) struct Recorded {
    pub(in crate::inbound::kafka_consumer) metrics: IndexMetrics,
    provider: SdkMeterProvider,
    exporter: InMemoryMetricExporter,
}

/// One exported data point: its tags, and a counter's sum, a gauge's reading,
/// or a histogram's count with its smallest recorded value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::inbound::kafka_consumer) struct Point {
    pub(in crate::inbound::kafka_consumer) tags: BTreeMap<String, String>,
    pub(in crate::inbound::kafka_consumer) value: u64,
    pub(in crate::inbound::kafka_consumer) min: Option<u64>,
}

impl Recorded {
    pub(in crate::inbound::kafka_consumer) fn new() -> Self {
        let exporter = InMemoryMetricExporter::default();
        let provider = SdkMeterProvider::builder()
            .with_periodic_exporter(exporter.clone())
            .build();
        Self {
            metrics: IndexMetrics::new(&provider.meter("test")),
            provider,
            exporter,
        }
    }

    /// Exports now and returns the points of `name`, sorted by tags.
    pub(in crate::inbound::kafka_consumer) fn points(&self, name: &str) -> Vec<Point> {
        self.exporter.reset();
        self.provider.force_flush().expect("metrics flush");
        let exported = self
            .exporter
            .get_finished_metrics()
            .expect("exported metrics");
        let tags = |attributes: &mut dyn Iterator<Item = &KeyValue>| {
            attributes
                .map(|attribute| (attribute.key.to_string(), attribute.value.to_string()))
                .collect::<BTreeMap<_, _>>()
        };
        let mut points: Vec<Point> = exported
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .filter(|metric| metric.name() == name)
            .flat_map(|metric| match metric.data() {
                AggregatedMetrics::U64(MetricData::Sum(sum)) => sum
                    .data_points()
                    .map(|point| Point {
                        tags: tags(&mut point.attributes()),
                        value: point.value(),
                        min: None,
                    })
                    .collect::<Vec<_>>(),
                AggregatedMetrics::U64(MetricData::Gauge(gauge)) => gauge
                    .data_points()
                    .map(|point| Point {
                        tags: tags(&mut point.attributes()),
                        value: point.value(),
                        min: None,
                    })
                    .collect(),
                AggregatedMetrics::U64(MetricData::Histogram(histogram)) => histogram
                    .data_points()
                    .map(|point| Point {
                        tags: tags(&mut point.attributes()),
                        value: point.count(),
                        min: point.min(),
                    })
                    .collect(),
                other => panic!("unexpected aggregation for {name}: {other:?}"),
            })
            .collect();
        points.sort_by(|a, b| a.tags.cmp(&b.tags));
        points
    }
}

pub(in crate::inbound::kafka_consumer) fn tags(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

#[test]
fn an_undecodable_record_counts_as_dropped_for_its_topics_entity_type() {
    let recorded = Recorded::new();

    recorded
        .metrics
        .record_loss("macro.email", Loss::Undecodable);
    recorded
        .metrics
        .record_loss("macro.email", Loss::Undecodable);
    recorded
        .metrics
        .record_loss("not.subscribed", Loss::Undecodable);

    assert_eq!(
        recorded.points(DROPPED),
        [
            Point {
                tags: tags(&[("entity_type", "email"), ("failure", "undecodable")]),
                value: 2,
                min: None,
            },
            Point {
                tags: tags(&[("failure", "undecodable")]),
                value: 1,
                min: None,
            },
        ]
    );
}

#[test]
fn oldest_pending_reports_fresh_partitions_with_their_entity_type() {
    let recorded = Recorded::new();
    let ages = recorded.metrics.pending_ages();

    ages.set("macro.email", 3, 42_000, Instant::now());
    ages.set("macro.documents", 0, 0, Instant::now());

    assert_eq!(
        recorded.points(OLDEST_PENDING),
        [
            Point {
                tags: tags(&[
                    ("entity_type", "document"),
                    ("partition", "0"),
                    ("topic", "macro.documents"),
                ]),
                value: 0,
                min: None,
            },
            Point {
                tags: tags(&[
                    ("entity_type", "email"),
                    ("partition", "3"),
                    ("topic", "macro.email"),
                ]),
                value: 42_000,
                min: None,
            },
        ]
    );

    ages.remove("macro.documents", 0);
    assert_eq!(
        recorded
            .points(OLDEST_PENDING)
            .iter()
            .map(|point| point.tags["topic"].as_str())
            .collect::<Vec<_>>(),
        ["macro.email"],
        "a removed partition stops reporting instead of repeating its last age"
    );
}

#[test]
fn a_reading_not_refreshed_goes_missing_instead_of_repeating() {
    let ages = PendingAges::default();
    let now = Instant::now();
    let Some(long_ago) = now.checked_sub(PENDING_STALE_AFTER) else {
        return;
    };

    ages.set("macro.email", 0, 9_000, long_ago);
    ages.set("macro.email", 1, 1_000, now);

    assert_eq!(ages.fresh(now), [("macro.email", 1, 1_000)]);
}

#[test]
fn every_subscribed_topic_has_its_own_entity_type() {
    let entity_types: Vec<_> = DeclaredMacroEvent::topics()
        .iter()
        .map(|topic| EntityType::from_topic(topic))
        .collect();

    assert!(entity_types.iter().all(Option::is_some), "{entity_types:?}");
    let mut distinct = entity_types.clone();
    distinct.sort_by_key(|entity_type| entity_type.map(EntityType::as_str));
    distinct.dedup();
    assert_eq!(distinct.len(), entity_types.len());
    assert_eq!(
        EntityType::from_topic("macro.email"),
        Some(EntityType::Email)
    );
}

#[test]
fn records_lost_at_a_stop_count_by_their_topics_entity_type() {
    let recorded = Recorded::new();

    for topic in ["macro.email", "macro.email", "macro.documents"] {
        recorded.metrics.record_loss(topic, Loss::NotRewound);
    }

    assert_eq!(
        recorded
            .points(DROPPED)
            .iter()
            .map(|point| (point.tags.clone(), point.value))
            .collect::<Vec<_>>(),
        [
            (
                tags(&[("entity_type", "document"), ("failure", "not_rewound")]),
                1
            ),
            (
                tags(&[("entity_type", "email"), ("failure", "not_rewound")]),
                2
            ),
        ]
    );
}

#[test]
fn the_lane_backlog_is_the_oldest_fresh_reading_per_lane() {
    use crate::domain::backlog::LaneBacklog;

    let recorded = Recorded::new();
    let ages = recorded.metrics.pending_ages();
    let now = Instant::now();

    assert_eq!(recorded.metrics.lane_backlog(now), None);

    ages.set("macro.email", 0, 4_000, now);
    ages.set("macro.email", 1, 9_000, now);
    ages.set("macro.documents", 0, 30_000, now);
    ages.set("macro.chats", 0, 0, now);
    if let Some(long_ago) = now.checked_sub(PENDING_STALE_AFTER) {
        ages.set("macro.messages", 0, 600_000, long_ago);
    }

    assert_eq!(
        recorded.metrics.lane_backlog(now),
        Some(LaneBacklog {
            live: Some(Duration::from_secs(30)),
            email: Some(Duration::from_secs(9)),
        }),
        "a stale reading does not count"
    );

    let email_only = Recorded::new();
    email_only
        .metrics
        .pending_ages()
        .set("macro.email", 3, 0, now);
    assert_eq!(
        email_only.metrics.lane_backlog(now),
        Some(LaneBacklog {
            live: None,
            email: Some(Duration::ZERO),
        }),
        "a lane the task owns nothing in has no reading"
    );
}
