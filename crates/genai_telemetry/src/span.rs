//! Attribute helpers that write straight to a span's OpenTelemetry data.
//!
//! `tracing` only records fields a span declared when it was created, so a
//! span opened by another crate (the agent runtime's `chat` and `execute_tool`
//! spans) cannot take new fields through `Span::record`. `tracing-opentelemetry`
//! exposes the underlying OpenTelemetry span, which accepts any attribute at
//! any time before the span closes. Writing there has a second benefit: the
//! JSON log layer repeats a span's `tracing` fields on every log line emitted
//! inside it, and content attributes are far too large for that.
//!
//! Every setter is a no-op when no OpenTelemetry layer is installed (local
//! runs without a collector, unit tests without a subscriber).

#[cfg(test)]
mod test;

use opentelemetry::trace::Status;
use opentelemetry::{Array, Key, StringValue, Value};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

use crate::attr;

/// Attribute setters for GenAI spans; implemented for [`tracing::Span`].
pub trait GenAiSpanExt {
    /// Set a string attribute.
    fn set_str(&self, key: &'static str, value: impl Into<String>);
    /// Set an integer attribute.
    fn set_i64(&self, key: &'static str, value: i64);
    /// Set an integer attribute from a `u64`, saturating at `i64::MAX`.
    fn set_u64(&self, key: &'static str, value: u64);
    /// Set a float attribute.
    fn set_f64(&self, key: &'static str, value: f64);
    /// Set a boolean attribute.
    fn set_bool(&self, key: &'static str, value: bool);
    /// Set a string-array attribute.
    fn set_str_array<I, S>(&self, key: &'static str, values: I)
    where
        I: IntoIterator<Item = S>,
        S: Into<String>;
    /// Mark the span failed: records `error.type` and sets the OpenTelemetry
    /// error status with `description`.
    fn set_error(&self, error_type: &str, description: impl Into<String>);
}

impl GenAiSpanExt for tracing::Span {
    fn set_str(&self, key: &'static str, value: impl Into<String>) {
        self.set_attribute(
            Key::from_static_str(key),
            Value::String(value.into().into()),
        );
    }

    fn set_i64(&self, key: &'static str, value: i64) {
        self.set_attribute(Key::from_static_str(key), Value::I64(value));
    }

    fn set_u64(&self, key: &'static str, value: u64) {
        self.set_i64(key, i64::try_from(value).unwrap_or(i64::MAX));
    }

    fn set_f64(&self, key: &'static str, value: f64) {
        self.set_attribute(Key::from_static_str(key), Value::F64(value));
    }

    fn set_bool(&self, key: &'static str, value: bool) {
        self.set_attribute(Key::from_static_str(key), Value::Bool(value));
    }

    fn set_str_array<I, S>(&self, key: &'static str, values: I)
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let values: Vec<StringValue> = values.into_iter().map(|v| v.into().into()).collect();
        self.set_attribute(
            Key::from_static_str(key),
            Value::Array(Array::String(values)),
        );
    }

    fn set_error(&self, error_type: &str, description: impl Into<String>) {
        self.set_str(attr::ERROR_TYPE, error_type);
        self.set_status(Status::error(description.into()));
    }
}

/// Whether the current span was opened under `name`.
///
/// Lets an inner layer tell that an outer runtime already opened the semconv
/// span for the operation in flight — the agent runtime's `execute_tool` span
/// around a tool dispatch, say — so it enriches that span instead of nesting a
/// duplicate. `false` when there is no current span.
pub fn current_span_is_named(name: &str) -> bool {
    tracing::Span::current()
        .metadata()
        .is_some_and(|metadata| metadata.name() == name)
}
