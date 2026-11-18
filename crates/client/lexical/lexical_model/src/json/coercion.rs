//! JavaScript primitive coercions for JSON values at stored-format boundaries.
use serde_json::Value;
/// `String(value)` for JSON-representable values, including array joining.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Object(_) => "[object Object]".into(),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                if value.is_null() {
                    String::new()
                } else {
                    js_string(value)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        value => super::to_js_json_string(value),
    }
}
/// `Number(value)` for JSON-representable values; invalid conversions return NaN.
pub fn js_to_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(value) => f64::from(u8::from(*value)),
        Value::Number(value) => value.as_f64().unwrap_or(f64::NAN),
        Value::Object(_) => f64::NAN,
        Value::Array(_) => string_to_number(&js_string(value)),
        Value::String(value) => string_to_number(value),
    }
}
fn string_to_number(value: &str) -> f64 {
    let value = crate::js_trim(value);
    match value {
        "" => return 0.0,
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix, bits) in [("0x", 16, 4), ("0b", 2, 1), ("0o", 8, 3)] {
        if let Some(digits) = value
            .strip_prefix(prefix)
            .or_else(|| value.strip_prefix(&prefix.to_uppercase()))
        {
            return radix_to_number(digits, radix, bits);
        }
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'+' | b'-' | b'e' | b'E'))
    {
        return f64::NAN;
    }
    value.parse().unwrap_or(f64::NAN)
}
fn radix_to_number(value: &str, radix: u32, bits: u32) -> f64 {
    if value.is_empty() {
        return f64::NAN;
    }
    let Some(digits) = value
        .chars()
        .map(|c| c.to_digit(radix))
        .collect::<Option<Vec<_>>>()
    else {
        return f64::NAN;
    };
    let mut total = 0usize;
    let mut significant = 0u64;
    let mut sticky = false;
    for bit in digits
        .iter()
        .flat_map(|digit| (0..bits).rev().map(move |shift| (digit >> shift) & 1))
        .skip_while(|bit| *bit == 0)
    {
        if total < 54 {
            significant = (significant << 1) | u64::from(bit);
        } else {
            sticky |= bit != 0;
        }
        total += 1;
    }
    if total <= 53 {
        return significant as f64;
    }
    if total > 1024 {
        return f64::INFINITY;
    }
    let mantissa = significant >> 1;
    let round = significant & 1 != 0 && (sticky || mantissa & 1 != 0);
    (mantissa + u64::from(round)) as f64 * 2.0_f64.powi((total - 53) as i32)
}
