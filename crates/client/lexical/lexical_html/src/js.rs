//! JavaScript scalar serialization used by node exports.
use base64::{Engine, engine::general_purpose::STANDARD};
/// JavaScript Number.toString, sharing the model's canonical number writer.
pub fn js_number_to_string(number: f64) -> String {
    if number.is_nan() {
        return "NaN".to_owned();
    }
    if number.is_infinite() {
        return if number.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .to_owned();
    }
    lexical_model::to_js_json_string(&lexical_model::json::js_number(number))
}
/// Padded base64 of Latin-1 bytes; None for characters beyond U+00FF.
pub fn btoa(text: &str) -> Option<String> {
    text.chars()
        .map(|ch| u8::try_from(u32::from(ch)).ok())
        .collect::<Option<Vec<_>>>()
        .map(|bytes| STANDARD.encode(bytes))
}
/// Latin-1 base64 when possible; UTF-8 base64 for equations JavaScript would reject.
pub fn btoa_or_utf8(text: &str) -> String {
    btoa(text).unwrap_or_else(|| STANDARD.encode(text.as_bytes()))
}
