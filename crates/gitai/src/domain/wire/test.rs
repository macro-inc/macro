use std::collections::BTreeMap;

use super::*;
use crate::fakes::fixture;

const METRICS_FIXTURES: [&str; 7] = [
    "metrics-upload-mixed.json",
    "metrics-upload-sweep-allowed-only.json",
    "metrics-upload-503.json",
    "metrics-upload-429-retry-after.json",
    "metrics-upload-401.json",
    "metrics-upload-errors-array.json",
    "metrics-upload-retry-after-503.json",
];

fn decode(name: &str) -> Vec<MetricEvent> {
    let batch: MetricsBatch = serde_json::from_value(fixture(name)["body"].clone()).unwrap();
    assert_eq!(batch.version, 1, "{name}");
    batch
        .events
        .into_iter()
        .map(|event| MetricEvent::parse(event).unwrap())
        .collect()
}

#[test]
fn every_recorded_metrics_upload_decodes() {
    for name in METRICS_FIXTURES {
        let events = decode(name);
        assert!(!events.is_empty(), "{name}");
        assert!(
            events
                .iter()
                .all(|event| event.kind() != EventKind::Unknown),
            "{name}"
        );
    }
}

#[test]
fn the_mixed_upload_has_every_kind_the_client_produced() {
    let mut kinds: BTreeMap<EventKind, usize> = BTreeMap::new();
    for event in decode("metrics-upload-mixed.json") {
        *kinds.entry(event.kind()).or_default() += 1;
    }
    assert_eq!(
        kinds,
        BTreeMap::from([
            (EventKind::Committed, 5),
            (EventKind::AgentUsage, 2),
            (EventKind::Checkpoint, 5),
            (EventKind::SessionEvent, 13),
            (EventKind::TokenUsage, 2),
        ])
    );
}

#[test]
fn reads_attributes_and_values_by_position() {
    let events = decode("metrics-upload-mixed.json");
    let commit = events
        .iter()
        .find(|event| {
            event.value_str(committed::COMMIT_SUBJECT) == Some("feat: add greeting helper")
        })
        .unwrap();
    assert_eq!(
        commit.attr_str(attr::REPO_URL),
        Some("https://github.com/macro-inc/macro")
    );
    assert_eq!(commit.attr_str(attr::BRANCH), Some("main"));
    assert_eq!(commit.value_u64(committed::GIT_DIFF_ADDED_LINES), Some(2));
    assert!(
        commit
            .value_str(committed::AUTHORSHIP_NOTE)
            .unwrap()
            .contains("authorship/3.0.0")
    );
}

#[test]
fn unknown_ids_and_positions_survive_untouched() {
    let raw = serde_json::json!({"t": 1, "e": 42, "a": {"1": "x", "99": [1, 2]}, "v": {"77": {"new": true}}});
    let event = MetricEvent::parse(raw.clone()).unwrap();
    assert_eq!(event.kind(), EventKind::Unknown);
    assert_eq!(Value::Object(event.raw().clone()), raw);
}

#[test]
fn malformed_events_are_refused() {
    for raw in [
        serde_json::json!([1, 2]),
        serde_json::json!({"e": 1}),
        serde_json::json!({"t": 1}),
        serde_json::json!({"t": "now", "e": 1}),
        serde_json::json!({"t": 1, "e": 1, "a": []}),
    ] {
        assert!(MetricEvent::parse(raw.clone()).is_err(), "{raw}");
    }
}
