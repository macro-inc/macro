use std::collections::BTreeMap;

use serde_json::json;

use super::super::{Begin, Record};
use super::{MAX_EVENT_AGE_NS, logs, traces};

const NOW_NS: u64 = 1_800_000_000_000_000_000;

fn begin() -> Begin {
    Begin {
        run_id: "run1".to_owned(),
        started_ns: NOW_NS - 60_000_000_000,
        common: BTreeMap::from([("kind".to_owned(), json!("up"))]),
    }
}

fn record(seq: u32, at_ns: u64) -> Record {
    Record {
        seq,
        event: "step".to_owned(),
        name: Some("Running migrations".to_owned()),
        at_ns,
        duration_ns: Some(2_000_000_000),
        fields: BTreeMap::from([
            ("seconds".to_owned(), json!(2.0)),
            ("units".to_owned(), json!(3)),
            ("cached".to_owned(), json!(true)),
            ("outcome".to_owned(), json!("failure")),
        ]),
    }
}

#[test]
fn values_keep_their_otlp_types() {
    let body = logs(&begin(), &[record(1, NOW_NS)], NOW_NS);
    let attributes = &body["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]["attributes"];
    assert_eq!(
        attributes,
        &json!([
            { "key": "cached", "value": { "boolValue": true } },
            { "key": "event", "value": { "stringValue": "step" } },
            { "key": "kind", "value": { "stringValue": "up" } },
            { "key": "outcome", "value": { "stringValue": "failure" } },
            { "key": "run_id", "value": { "stringValue": "run1" } },
            { "key": "seconds", "value": { "doubleValue": 2.0 } },
            { "key": "units", "value": { "intValue": "3" } },
        ])
    );
}

#[test]
fn old_events_are_stamped_as_late_as_loki_accepts() {
    let old = NOW_NS - 2 * MAX_EVENT_AGE_NS;
    let recent = NOW_NS - 5_000_000_000;
    let body = logs(&begin(), &[record(1, old), record(2, recent)], NOW_NS);
    let records = &body["resourceLogs"][0]["scopeLogs"][0]["logRecords"];
    assert_eq!(
        records[0]["timeUnixNano"],
        json!((NOW_NS - MAX_EVENT_AGE_NS).to_string())
    );
    assert_eq!(records[1]["timeUnixNano"], json!(recent.to_string()));
}

#[test]
fn a_line_sent_twice_is_identical() {
    let first = logs(&begin(), &[record(4, NOW_NS)], NOW_NS);
    let again = logs(&begin(), &[record(4, NOW_NS)], NOW_NS + 1_000_000_000);
    assert_eq!(first, again);
    assert_eq!(
        first["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]["body"],
        json!({ "stringValue": "step run1 4" })
    );
}

#[test]
fn a_failed_step_is_an_error_span_ending_at_its_event() {
    let body = traces(&begin(), &[record(1, NOW_NS)]).expect("a span");
    let span = &body["resourceSpans"][0]["scopeSpans"][0]["spans"][0];
    assert_eq!(span["status"], json!({ "code": 2 }));
    assert_eq!(span["endTimeUnixNano"], json!(NOW_NS.to_string()));
    assert_eq!(
        span["startTimeUnixNano"],
        json!((NOW_NS - 2_000_000_000).to_string())
    );
}

#[test]
fn events_without_a_duration_are_not_spans() {
    let mut instant = record(1, NOW_NS);
    instant.duration_ns = None;
    assert_eq!(traces(&begin(), &[instant]), None);
}
