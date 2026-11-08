//! Primitive development compatibility exports, independent of editor lifetimes.
use lexical_model::TextFormat;
use serde::Serialize;
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

#[cfg(feature = "js-nodes")]
static KEYS: std::sync::LazyLock<lexical_model::SharedKeyCounter> =
    std::sync::LazyLock::new(lexical_model::SharedKeyCounter::new);

/// Restart the shim's shared allocation stream while advancing its key generation.
#[cfg(feature = "js-nodes")]
#[wasm_bindgen]
pub fn reset_key_counter() -> Result<(), JsError> {
    KEYS.reset().map_err(super::debug::error)
}

/// Allocate an upstream-compatible visible key without creating a model record.
#[cfg(feature = "js-nodes")]
#[wasm_bindgen]
pub fn generate_random_key() -> Result<String, JsError> {
    KEYS.allocate_for_foreign_host()
        .map(|key| super::debug::returned_string(key.to_string()))
        .map_err(super::debug::error)
}

fn format_flags() -> Map<String, Value> {
    TextFormat::all()
        .iter_names()
        .map(|(name, flag)| (format!("IS_{name}"), Value::from(flag.bits())))
        .collect()
}

/// The model's complete upstream text-format bit definitions as an ordinary object.
#[wasm_bindgen]
pub fn text_format_flags() -> Result<JsValue, JsError> {
    let flags = Value::Object(format_flags());
    let result = flags
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
        .map_err(super::debug::error)?;
    super::debug::returned_json(&flags);
    Ok(result)
}

#[cfg(test)]
mod test;
