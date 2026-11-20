use std::collections::BTreeMap;
use std::time::Duration;

use opentelemetry::metrics::MeterProvider as _;
use opentelemetry_sdk::metrics::data::{AggregatedMetrics, MetricData};
use opentelemetry_sdk::metrics::{InMemoryMetricExporter, SdkMeterProvider};

use super::*;
use crate::domain::model::{EntityType, Operation};

type Tags = BTreeMap<String, String>;
/// A round counter series: its tags and sum.
type Count = (Tags, u64);
/// A histogram series: its tags, count and largest value.
type Seconds = (Tags, u64, f64);

/// Records `rounds` and returns the exported points: each round counter's
/// tags and sum, and each histogram series' tags, count and largest value.
fn export(rounds: &[Round]) -> (Vec<Count>, Vec<Seconds>) {
    let exporter = InMemoryMetricExporter::default();
    let provider = SdkMeterProvider::builder()
        .with_periodic_exporter(exporter.clone())
        .build();
    let metrics = ProbeMetrics::new(&provider.meter("test"));
    for round in rounds {
        metrics.record(*round);
    }
    provider.force_flush().expect("metrics flush");

    let tags = |attributes: &mut dyn Iterator<Item = &KeyValue>| -> Tags {
        attributes
            .map(|attribute| (attribute.key.to_string(), attribute.value.to_string()))
            .collect()
    };
    let mut counts = Vec::new();
    let mut seconds = Vec::new();
    for metric in exporter
        .get_finished_metrics()
        .expect("exported metrics")
        .iter()
        .flat_map(|resource| resource.scope_metrics())
        .flat_map(|scope| scope.metrics())
    {
        match (metric.name(), metric.data()) {
            (PROBE_ROUNDS, AggregatedMetrics::U64(MetricData::Sum(sum))) => {
                counts.extend(
                    sum.data_points()
                        .map(|point| (tags(&mut point.attributes()), point.value())),
                );
            }
            (PROBE_SECONDS, AggregatedMetrics::F64(MetricData::Histogram(histogram))) => {
                seconds.extend(histogram.data_points().map(|point| {
                    (
                        tags(&mut point.attributes()),
                        point.count(),
                        point.max().unwrap_or_default(),
                    )
                }));
            }
            _ => {}
        }
    }
    counts.sort();
    seconds.sort_by(|left, right| left.0.cmp(&right.0));
    (counts, seconds)
}

fn tags(pairs: &[(&str, &str)]) -> Tags {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

#[test]
fn a_seen_round_records_its_seconds_and_every_round_counts_by_outcome() {
    let (counts, seconds) = export(&[
        Round {
            entity_type: EntityType::Document,
            operation: Operation::Rename,
            outcome: Outcome::Seen(Duration::from_millis(2_500)),
        },
        Round {
            entity_type: EntityType::Document,
            operation: Operation::Rename,
            outcome: Outcome::Unseen,
        },
        Round {
            entity_type: EntityType::Document,
            operation: Operation::Rename,
            outcome: Outcome::Late(std::time::Duration::from_secs(90)),
        },
        Round {
            entity_type: EntityType::Call,
            operation: Operation::Rename,
            outcome: Outcome::WriteFailed,
        },
    ]);

    assert_eq!(
        counts,
        [
            (
                tags(&[
                    ("entity_type", "call"),
                    ("operation", "rename"),
                    ("outcome", "write_failed")
                ]),
                1
            ),
            (
                tags(&[
                    ("entity_type", "document"),
                    ("operation", "rename"),
                    ("outcome", "late")
                ]),
                1
            ),
            (
                tags(&[
                    ("entity_type", "document"),
                    ("operation", "rename"),
                    ("outcome", "seen")
                ]),
                1
            ),
            (
                tags(&[
                    ("entity_type", "document"),
                    ("operation", "rename"),
                    ("outcome", "unseen")
                ]),
                1
            ),
        ]
    );
    // Only the seen and late rounds have a time, and it carries no outcome
    // tag.
    assert_eq!(
        seconds,
        [(
            tags(&[("entity_type", "document"), ("operation", "rename")]),
            2,
            90.0
        )]
    );
}
