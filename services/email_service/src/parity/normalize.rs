//! Only explicitly volatile values are normalized; user-visible content is retained.

use regex::Regex;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::LazyLock;

static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
        .expect("UUID expression")
});
static TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?")
        .expect("timestamp expression")
});

#[derive(Clone, Default)]
pub(super) struct Normalizer {
    pub symbols: BTreeMap<String, String>,
    replacements: BTreeMap<String, String>,
    uuids: BTreeMap<String, String>,
}

impl Normalizer {
    pub fn symbol(&mut self, value: impl ToString, name: impl Into<String>) {
        self.symbols.insert(value.to_string(), name.into());
    }

    pub fn replace(&mut self, value: impl Into<String>, name: impl Into<String>) {
        self.replacements.insert(value.into(), name.into());
    }

    pub fn order_key(&self, value: &Value) -> String {
        let mut key = value.to_string();
        for (id, symbol) in &self.symbols {
            key = key.replace(id, symbol);
        }
        let key = TIMESTAMP.replace_all(&key, "<ts>");
        UUID.replace_all(&key, "<uuid>").into_owned()
    }

    pub fn text(&mut self, text: &str) -> String {
        let mut text = text.to_owned();
        let mut replacements: Vec<_> = self.symbols.iter().chain(&self.replacements).collect();
        replacements.sort_by_key(|(value, _)| std::cmp::Reverse(value.len()));
        for (value, replacement) in replacements {
            text = text.replace(value, replacement);
        }
        text = TIMESTAMP.replace_all(&text, "<ts>").into_owned();
        UUID.replace_all(&text, |captures: &regex::Captures<'_>| {
            let next = self.uuids.len() + 1;
            self.uuids
                .entry(captures[0].to_lowercase())
                .or_insert_with(|| format!("<uuid:{next}>"))
                .clone()
        })
        .into_owned()
    }

    pub fn value(&mut self, section: &str, value: Value) -> Value {
        let telemetry = matches!(section, "spans" | "logs" | "sql");
        match value {
            Value::String(text) => {
                // Backtraces are telemetry, never an excuse to trim application content.
                let text = if telemetry {
                    text.split("\n\nStack backtrace:")
                        .next()
                        .expect("error prefix")
                } else {
                    &text
                };
                Value::String(self.text(text))
            }
            Value::Array(values) => {
                Value::Array(values.into_iter().map(|v| self.value(section, v)).collect())
            }
            Value::Object(values) => {
                let changed_timestamp = section == "db"
                    && values.get("before") != values.get("after")
                    && ["before", "after"].iter().all(|key| {
                        values
                            .get(*key)
                            .and_then(Value::as_str)
                            .is_some_and(|text| {
                                TIMESTAMP
                                    .find(text)
                                    .is_some_and(|found| found.as_str() == text)
                            })
                    });
                let mut values: serde_json::Map<String, Value> = values
                    .into_iter()
                    .map(|(key, value)| {
                        let mask = (telemetry && telemetry_volatile_field(&key))
                            || (section == "sqs" && SQS_RECEIPT_FIELDS.contains(&key.as_str()));
                        let value = if mask && !value.is_null() {
                            Value::String("<volatile>".into())
                        } else if matches!(key.as_str(), "sql" | "name" | "provider_label_id")
                            && value.is_string()
                        {
                            // SQL text, span names, and provider label content are
                            // behavior even when they happen to resemble an ID/date.
                            value
                        } else {
                            self.value(section, value)
                        };
                        (key, value)
                    })
                    .collect();
                if changed_timestamp {
                    values.insert("after".into(), Value::String("<ts:changed>".into()));
                }
                Value::Object(values)
            }
            value => value,
        }
    }
}

const SQS_RECEIPT_FIELDS: &[&str] = &["receipt_handle", "ReceiptHandle"];

fn telemetry_volatile_field(key: &str) -> bool {
    matches!(
        key,
        "request_id"
            | "request.id"
            | "trace_id"
            | "span_id"
            | "http.request_id"
            | "http.response.header.x_request_id"
            | "time.busy"
            | "time.idle"
            | "elapsed"
            | "elapsed_secs"
            | "elapsed_ms"
            | "duration"
            | "duration_ms"
            | "latency_ms"
            | "receipt_handle"
            | "ReceiptHandle"
            | "sdk_invocation_id"
            | "port"
            | "server.port"
            | "peer.port"
    )
}
