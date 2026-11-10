//! BackfillRetryAfterCeiling: retain the refusal's whole-second scheduling boundary.

use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

static DURATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^Some\((\d+)(?:\.(\d+))?(s|ms|µs|ns)\)$").expect("Duration Debug")
});

pub(super) fn retry_after_ceiling(section: &str, fields: &mut Map<String, Value>) {
    if section != "spans"
        || fields.get("name").and_then(Value::as_str) != Some("defer_rate_limited_operation")
    {
        return;
    }
    if let Some(value) = fields
        .get_mut("fields")
        .and_then(|fields| fields.get_mut("retry_after"))
        && let Some(rounded) = value.as_str().and_then(whole_seconds)
    {
        *value = Value::String(rounded);
    }
}

fn whole_seconds(value: &str) -> Option<String> {
    let captures = DURATION.captures(value)?;
    let whole: u128 = captures[1].parse().ok()?;
    let fraction = captures.get(2).map_or("", |fraction| fraction.as_str());
    let scale = 10_u128.checked_pow(fraction.len().try_into().ok()?)?;
    let numerator = whole
        .checked_mul(scale)?
        .checked_add(if fraction.is_empty() {
            0
        } else {
            fraction.parse().ok()?
        })?;
    let nanos = match &captures[3] {
        "s" => 1_000_000_000,
        "ms" => 1_000_000,
        "µs" => 1_000,
        "ns" => 1,
        _ => return None,
    };
    let numerator = numerator.checked_mul(nanos)?;
    let denominator = scale.checked_mul(1_000_000_000)?;
    let seconds = numerator / denominator + u128::from(numerator % denominator != 0);
    Some(format!("Some({seconds}s)"))
}
