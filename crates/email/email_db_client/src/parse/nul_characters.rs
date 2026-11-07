//! PostgreSQL text cannot hold U+0000: a `text` or `varchar` value with one
//! fails with SQLSTATE 22021 and a `jsonb` string with 22P05, however often
//! the write is retried. Provider mail carries one now and then in a header or
//! body, and the providers pass it through, so one character used to keep the
//! whole message out of the mailbox.
//!
//! Mail clients show a NUL as nothing, so it is removed here, at the
//! service-to-db mapping boundary every insert path funnels through, as
//! `column_limits` clamps oversized values there.

use serde_json::Value;

/// Removes the NUL characters from a column value, logging the column (never
/// the value) so the provider data stays visible.
pub(crate) fn remove(mut value: String, column: &'static str) -> String {
    if value.contains('\0') {
        tracing::warn!(column, "removing NUL characters from a provider value");
        value.retain(|character| character != '\0');
    }
    value
}

/// [`remove`] for an optional column value.
pub(crate) fn remove_opt(value: Option<String>, column: &'static str) -> Option<String> {
    value.map(|value| remove(value, column))
}

/// Removes the NUL characters from every string and object key in a `jsonb`
/// value.
pub fn remove_from_json(value: &mut Value, column: &'static str) {
    match value {
        Value::String(text) => {
            if text.contains('\0') {
                *text = remove(std::mem::take(text), column);
            }
        }
        Value::Array(items) => {
            for item in items {
                remove_from_json(item, column);
            }
        }
        Value::Object(fields) => {
            if fields.keys().any(|key| key.contains('\0')) {
                *fields = std::mem::take(fields)
                    .into_iter()
                    .map(|(key, value)| (remove(key, column), value))
                    .collect();
            }
            for field in fields.values_mut() {
                remove_from_json(field, column);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}
