//! Decoding a view is checking it. A problem names where it is and what
//! belongs there, never what the view holds, since it is logged with the
//! failed call.

use crate::View;
use lazy_regex::{regex_captures, regex_is_match};
use serde_json::Value;

/// The view, or what the renderer would reject in it, with its place in the
/// view.
pub fn decode_view(view: &Value) -> Result<View, String> {
    serde_path_to_error::deserialize(view).map_err(|error| {
        let place = match error.path().to_string().as_str() {
            "." => "view".to_owned(),
            path => format!("view.{path}"),
        };
        format!(
            "{place} {}",
            without_content(&error.into_inner().to_string())
        )
    })
}

/// What serde says is wrong, with the value it found left out. Serde quotes
/// what it found before `, expected`; a message in no known shape is dropped.
fn without_content(message: &str) -> String {
    if let Some((_, field)) = regex_captures!(r"^missing field `([^`]*)`$", message) {
        return format!("is missing \"{field}\"");
    }
    if let Some((_, kind, expected)) = regex_captures!(
        r"^invalid type: (\w+(?: point| value)?).*, expected (.*)$",
        message
    ) {
        return format!(
            "should be {}, not {}",
            expected_name(expected),
            kind_name(kind)
        );
    }
    if let Some((_, expected)) = regex_captures!(r"^unknown variant .*, expected (.*)$", message) {
        return format!("should be {expected}");
    }
    if let Some((_, expected)) = regex_captures!(r"^invalid value: .*, expected (.*)$", message) {
        return format!("should be {}", expected_name(expected));
    }
    // A nutype bound: "Gap is too big. The value must be less or equal to 8."
    if let Some((_, bound)) = regex_captures!(r"The value must be ([^.]+)\.", message) {
        return format!("should be {bound}");
    }
    if let Some((_, name)) = regex_captures!(
        r"^data did not match any variant of untagged enum (\w+)$",
        message
    ) {
        return format!("matches no shape of {name}");
    }
    "is not valid".to_owned()
}

/// What serde expected, as a phrase: a struct or tagged enum is an object.
fn expected_name(expected: &str) -> &str {
    if regex_is_match!(r"^(struct|internally tagged enum|enum|map) ", expected) {
        return "an object";
    }
    match expected {
        "a sequence" => "an array",
        "u8" | "u16" | "u32" | "u64" | "usize" => "a whole number",
        "a boolean" => "true or false",
        other => other,
    }
}

/// Serde's word for what it found, as a phrase.
fn kind_name(kind: &str) -> &str {
    match kind {
        "string" => "a string",
        "integer" | "floating point" => "a number",
        "boolean" => "a boolean",
        "map" => "an object",
        "sequence" => "an array",
        "unit value" | "null" => "null",
        other => other,
    }
}

/// Deserialize a field holding a view, with [`decode_view`]'s problems as the
/// error, for a struct whose field is a view: `#[serde(deserialize_with =
/// "dynamic_ui::deserialize_view")]`.
pub fn deserialize_view<'de, D>(deserializer: D) -> Result<View, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = <Value as serde::Deserialize>::deserialize(deserializer)?;
    decode_view(&value).map_err(serde::de::Error::custom)
}
