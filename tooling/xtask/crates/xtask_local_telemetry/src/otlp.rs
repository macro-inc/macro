//! OTLP/HTTP JSON for buffered events: one log record each for Loki, and a span
//! for each event with a duration for Tempo.
//!
//! The log shape copies CI's exporter (`ci_telemetry_collect.ts`): one resource
//! with `service.name`, so the run_local events are their own small Loki stream,
//! every field as structured metadata, and a body that is the same each time a
//! line is sent, so Loki drops a line delivered twice.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::{Begin, RUN_EVENT, Record, hex_digest};

#[cfg(test)]
mod test;

pub(crate) const SERVICE_NAME: &str = "local-telemetry";
const ENVIRONMENT: &str = "local";
/// Loki refuses a line this far behind its stream's newest one, as CI's exporter
/// notes. An older event keeps its fields but is stamped this long ago.
pub(crate) const MAX_EVENT_AGE_NS: u64 = 1_800 * 1_000_000_000;
const SPAN_KIND_INTERNAL: u8 = 1;
const STATUS_ERROR: u8 = 2;

/// The trace every event of a run belongs to.
fn trace_id(run_id: &str) -> String {
    hex_digest(format!("{SERVICE_NAME}{run_id}t").as_bytes())[..32].to_owned()
}

/// A record's span, or the run's root span for its `run` event.
fn span_id(run_id: &str, record: &Record) -> String {
    if record.event == RUN_EVENT {
        return root_span_id(run_id);
    }
    hex_digest(format!("{run_id}/{}", record.seq).as_bytes())[..16].to_owned()
}

fn root_span_id(run_id: &str) -> String {
    hex_digest(format!("{run_id}/root").as_bytes())[..16].to_owned()
}

fn resource() -> Value {
    json!({
        "attributes": [
            { "key": "service.name", "value": { "stringValue": SERVICE_NAME } },
            { "key": "deployment.environment", "value": { "stringValue": ENVIRONMENT } },
        ]
    })
}

fn any_value(value: &Value) -> Value {
    match value {
        Value::Bool(flag) => json!({ "boolValue": flag }),
        Value::Number(number) if number.is_i64() || number.is_u64() => {
            json!({ "intValue": number.to_string() })
        }
        Value::Number(number) => json!({ "doubleValue": number.as_f64() }),
        Value::String(text) => json!({ "stringValue": text }),
        other => json!({ "stringValue": other.to_string() }),
    }
}

fn attributes<'a>(fields: impl Iterator<Item = (&'a String, &'a Value)>) -> Vec<Value> {
    fields
        .map(|(key, value)| json!({ "key": key, "value": any_value(value) }))
        .collect()
}

/// Every field of a record: the run's common ones, then `event` and its own.
fn merged<'a>(begin: &'a Begin, record: &'a Record) -> BTreeMap<&'a String, &'a Value> {
    let mut fields: BTreeMap<&String, &Value> = begin.common.iter().collect();
    fields.extend(record.fields.iter());
    fields
}

/// The logs request for `records`. A record's time is its own, clamped to what
/// Loki will accept at `now_ns`.
pub(crate) fn logs(begin: &Begin, records: &[Record], now_ns: u64) -> Value {
    let oldest = now_ns.saturating_sub(MAX_EVENT_AGE_NS);
    let trace = trace_id(&begin.run_id);
    let log_records: Vec<Value> = records
        .iter()
        .map(|record| {
            let event = Value::String(record.event.clone());
            let run_id = Value::String(begin.run_id.clone());
            let event_key = "event".to_owned();
            let run_key = "run_id".to_owned();
            let mut fields = merged(begin, record);
            fields.insert(&event_key, &event);
            fields.insert(&run_key, &run_id);
            json!({
                "timeUnixNano": record.at_ns.max(oldest).to_string(),
                "severityText": "INFO",
                "body": { "stringValue": format!("{} {} {}", record.event, begin.run_id, record.seq) },
                "traceId": trace,
                "spanId": span_id(&begin.run_id, record),
                "attributes": attributes(fields.into_iter()),
            })
        })
        .collect();
    json!({
        "resourceLogs": [{
            "resource": resource(),
            "scopeLogs": [{ "scope": { "name": SERVICE_NAME }, "logRecords": log_records }],
        }]
    })
}

/// The traces request: a span per record that has a duration, under the run's
/// root span. `None` when no record has one.
pub(crate) fn traces(begin: &Begin, records: &[Record]) -> Option<Value> {
    let trace = trace_id(&begin.run_id);
    let root = root_span_id(&begin.run_id);
    let spans: Vec<Value> = records
        .iter()
        .filter_map(|record| {
            let duration = record.duration_ns?;
            let mut span = json!({
                "traceId": trace,
                "spanId": span_id(&begin.run_id, record),
                "name": record.name.clone().unwrap_or_else(|| record.event.clone()),
                "kind": SPAN_KIND_INTERNAL,
                "startTimeUnixNano": record.at_ns.saturating_sub(duration).to_string(),
                "endTimeUnixNano": record.at_ns.to_string(),
                "attributes": attributes(merged(begin, record).into_iter()),
            });
            if record.event != RUN_EVENT {
                span["parentSpanId"] = Value::String(root.clone());
            }
            if record.fields.get("outcome").and_then(Value::as_str) == Some("failure") {
                span["status"] = json!({ "code": STATUS_ERROR });
            }
            Some(span)
        })
        .collect();
    if spans.is_empty() {
        return None;
    }
    Some(json!({
        "resourceSpans": [{
            "resource": resource(),
            "scopeSpans": [{ "scope": { "name": SERVICE_NAME }, "spans": spans }],
        }]
    }))
}
