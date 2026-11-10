//! Only explicitly volatile values are normalized; user-visible content is retained.

use regex::Regex;
use serde_json::Value;
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::sync::LazyLock;

mod test;

static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
        .expect("UUID expression")
});
static EMBEDDED_UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
        .expect("embedded UUID expression")
});
/// A Postgres error's debug text names the server source file and line that
/// raised it. The line differs between server versions; the file and routine
/// are kept.
static POSTGRES_SOURCE_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(file: Some\((?:\\)*"[A-Za-z0-9_]+\.c(?:\\)*"\), line: Some\()\d+(\))"#)
        .expect("Postgres source line expression")
});
static TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?")
        .expect("timestamp expression")
});

#[derive(Clone, Default)]
pub(super) struct Normalizer {
    pub symbols: BTreeMap<String, String>,
    pub sort_response_keys: bool,
    pub sort_sfs_source_sets: bool,
    pub normalize_gmail_redis_clock: bool,
    pub normalize_embedded_uuids: bool,
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
        let pattern = if self.normalize_embedded_uuids {
            &*EMBEDDED_UUID
        } else {
            &*UUID
        };
        pattern.replace_all(&key, "<uuid>").into_owned()
    }

    pub fn text(&mut self, text: &str) -> String {
        let mut text = text.to_owned();
        let mut replacements: Vec<_> = self.symbols.iter().chain(&self.replacements).collect();
        replacements.sort_by_key(|(value, _)| std::cmp::Reverse(value.len()));
        for (value, replacement) in replacements {
            text = text.replace(value, replacement);
        }
        text = TIMESTAMP.replace_all(&text, "<ts>").into_owned();
        let pattern = if self.normalize_embedded_uuids {
            &*EMBEDDED_UUID
        } else {
            &*UUID
        };
        pattern
            .replace_all(&text, |captures: &regex::Captures<'_>| {
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
                    let text = without_backtrace(&text);
                    Cow::Owned(
                        POSTGRES_SOURCE_LINE
                            .replace_all(&text, "${1}<postgres-source-line>${2}")
                            .into_owned(),
                    )
                } else {
                    Cow::Borrowed(text.as_str())
                };
                Value::String(self.text(&text))
            }
            Value::Array(values) => {
                Value::Array(values.into_iter().map(|v| self.value(section, v)).collect())
            }
            Value::Object(mut values) => {
                if self.normalize_gmail_redis_clock && section == "redis" {
                    for (key, change) in values.iter_mut() {
                        if key.starts_with("gmail:{") && key.ends_with(":window") {
                            for side in ["before", "after"] {
                                if let Some(buckets) = change[side].as_object() {
                                    let units: i64 = buckets
                                        .values()
                                        .map(|v| {
                                            v.as_str()
                                                .expect("Redis quota units")
                                                .parse::<i64>()
                                                .expect("integer quota units")
                                        })
                                        .sum();
                                    change[side] =
                                        serde_json::json!({"<window-units>":units.to_string()});
                                }
                            }
                        } else if key.starts_with("gmail:{") && key.ends_with(":limit") {
                            for side in ["before", "after"] {
                                if let Some(limit) = change[side].as_object_mut()
                                    && limit.contains_key("at")
                                {
                                    limit.insert("at".into(), Value::String("<redis-time>".into()));
                                }
                            }
                        }
                    }
                }
                if self.sort_sfs_source_sets
                    && section == "spans"
                    && values.get("name").and_then(Value::as_str) == Some("fetch_sfs_mappings")
                    && let Some(sources) = values
                        .get_mut("fields")
                        .and_then(|fields| fields.get_mut("sources"))
                    && let Some(ordered) = sources.as_str().and_then(ordered_debug_string_set)
                {
                    *sources = Value::String(ordered);
                }
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
                        let key = if self.normalize_gmail_redis_clock && section == "redis" {
                            self.text(&key)
                        } else {
                            key
                        };
                        (key, value)
                    })
                    .collect();
                if changed_timestamp {
                    values.insert("after".into(), Value::String("<ts:changed>".into()));
                }
                // Read summaries serialize HashMaps. Object order is not JSON
                // behavior; array order still is. Opt in to preserve old goldens.
                if self.sort_response_keys && section == "response" {
                    values.sort_keys();
                }
                Value::Object(values)
            }
            value => value,
        }
    }
}

/// Rust Debug string sets have no order. URLs use JSON-compatible escapes;
/// preserve every element and leave any unrecognized representation untouched.
fn ordered_debug_string_set(text: &str) -> Option<String> {
    let values = text.strip_prefix('{')?.strip_suffix('}')?;
    let mut values: Vec<String> = serde_json::from_str(&format!("[{values}]")).ok()?;
    values.sort();
    let values = values
        .iter()
        .map(|value| serde_json::to_string(value).expect("source URL JSON"))
        .collect::<Vec<_>>()
        .join(", ");
    Some(format!("{{{values}}}"))
}

fn without_backtrace(text: &str) -> Cow<'_, str> {
    // Some domain errors hold an anyhow Debug report inside a String. Their
    // outer Debug rendering escapes the backtrace's newlines and adds a quote.
    if let Some((message, backtrace)) = text.split_once("\\n\\nStack backtrace:") {
        let backtrace = backtrace.trim_end();
        let content = backtrace.trim_end_matches(')');
        if content.ends_with('"') {
            let closing = &backtrace[content.len()..];
            return Cow::Owned(format!("{message}\"{closing}"));
        }
    }
    let Some((message, backtrace)) = text.split_once("\n\nStack backtrace:") else {
        return Cow::Borrowed(text);
    };
    // Debug-formatting an enum around anyhow::Error closes the tuple after
    // the backtrace. Keep those delimiters, just as in its non-backtrace form.
    let backtrace = backtrace.trim_end();
    let closing = &backtrace[backtrace.trim_end_matches(')').len()..];
    Cow::Owned(format!("{message}{closing}"))
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
