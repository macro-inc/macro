//! Development diagnostics; export entries are instrumented after optimization.
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use wasm_bindgen::prelude::*;

static CROSSINGS: AtomicU64 = AtomicU64::new(0);
static BOUNDARY_BYTES: AtomicU64 = AtomicU64::new(0);
static LIVE_EDITORS: AtomicU32 = AtomicU32::new(0);

/// Raw counter hook consumed by the postprocessor, without a JS binding facade.
/// The reserved export name is unique within this development-only module.
#[cfg(target_arch = "wasm32")]
#[unsafe(export_name = "__lexical_record_export_entry")]
pub extern "C" fn record_export_entry(incoming_bytes: u32) {
    CROSSINGS.fetch_add(1, Ordering::Relaxed);
    add_bytes(u64::from(incoming_bytes));
}

/// Actual exported function calls since reset, including this observation.
#[wasm_bindgen]
pub fn debug_crossings() -> f64 {
    add_bytes(8);
    CROSSINGS.load(Ordering::Relaxed) as f64
}

/// Editor facades still owned by JS; internal view peers share their facade owner.
#[wasm_bindgen]
pub fn debug_live_editors() -> u32 {
    add_bytes(4);
    LIVE_EDITORS.load(Ordering::Relaxed)
}

/// Begin a fresh crossing measurement without changing editor ownership.
/// The reset entry precedes the new measurement interval.
#[wasm_bindgen]
pub fn debug_reset_counters() {
    CROSSINGS.store(0, Ordering::Relaxed);
    BOUNDARY_BYTES.store(0, Ordering::Relaxed);
}

pub(crate) struct LiveEditor;
impl LiveEditor {
    pub(crate) fn new() -> Self {
        LIVE_EDITORS.fetch_add(1, Ordering::Relaxed);
        Self
    }
}
impl Drop for LiveEditor {
    fn drop(&mut self) {
        LIVE_EDITORS.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Logical bytes transferred since reset, including this eight-byte observation.
#[wasm_bindgen]
pub fn debug_boundary_bytes() -> f64 {
    add_bytes(8);
    BOUNDARY_BYTES.load(Ordering::Relaxed) as f64
}

/// Private postprocessor target; direct exported calls have ordinary entry wrappers.
#[cfg(target_arch = "wasm32")]
#[unsafe(export_name = "__lexical_record_payload_bytes")]
pub extern "C" fn record_payload_bytes(bytes: u64) {
    add_bytes(bytes);
}

fn add_bytes(bytes: u64) {
    BOUNDARY_BYTES.fetch_add(bytes, Ordering::Relaxed);
}

pub(crate) fn returned_string(value: String) -> String {
    add_bytes(value.encode_utf16().count() as u64 * 2);
    value
}

pub(crate) fn returned_handle<T>(value: T) -> T {
    add_bytes(4);
    value
}

pub(crate) fn error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&returned_string(error.to_string()))
}

// Object keys and values are transferred recursively. Container metadata and
// null carry no payload; JS numbers use f64, and booleans use one logical byte.
pub(crate) fn json_payload(value: &serde_json::Value) {
    fn bytes(value: &serde_json::Value) -> u64 {
        match value {
            serde_json::Value::Null => 0,
            serde_json::Value::Bool(_) => 1,
            serde_json::Value::Number(_) => 8,
            serde_json::Value::String(s) => s.encode_utf16().count() as u64 * 2,
            serde_json::Value::Array(a) => a.iter().map(bytes).sum(),
            serde_json::Value::Object(o) => o
                .iter()
                .map(|(k, v)| k.encode_utf16().count() as u64 * 2 + bytes(v))
                .sum(),
        }
    }
    add_bytes(bytes(value));
}

#[cfg(feature = "js-nodes")]
pub(crate) fn returned_bytes(bytes: &[u8]) {
    add_bytes(bytes.len() as u64);
}
