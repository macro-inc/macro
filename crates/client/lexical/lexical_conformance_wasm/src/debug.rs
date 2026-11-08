//! Development diagnostics; export entries are instrumented after optimization.
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use wasm_bindgen::prelude::*;

static CROSSINGS: AtomicU64 = AtomicU64::new(0);
static LIVE_EDITORS: AtomicU32 = AtomicU32::new(0);

/// Raw counter hook consumed by the postprocessor, without a JS binding facade.
/// The reserved export name is unique within this development-only module.
#[cfg(target_arch = "wasm32")]
#[unsafe(export_name = "__lexical_record_export_entry")]
pub extern "C" fn record_export_entry(_incoming_bytes: u32) {
    CROSSINGS.fetch_add(1, Ordering::Relaxed);
}

/// Actual exported function calls since reset, including this observation.
#[wasm_bindgen]
pub fn debug_crossings() -> f64 {
    CROSSINGS.load(Ordering::Relaxed) as f64
}

/// Editor facades still owned by JS; internal view peers share their facade owner.
#[wasm_bindgen]
pub fn debug_live_editors() -> u32 {
    LIVE_EDITORS.load(Ordering::Relaxed)
}

/// Begin a fresh crossing measurement without changing editor ownership.
/// The reset entry precedes the new measurement interval.
#[wasm_bindgen]
pub fn debug_reset_counters() {
    CROSSINGS.store(0, Ordering::Relaxed);
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
