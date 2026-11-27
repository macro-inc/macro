use std::rc::Rc;

use cache_turso::query_telemetry::{QueryTelemetry, set_query_telemetry};
use js_sys::Function;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = performance, js_name = now)]
    fn performance_now() -> Result<f64, JsValue>;
}

/// Milliseconds on this worker's monotonic clock.
pub(crate) fn now_ms() -> f64 {
    performance_now().unwrap_or(f64::NAN)
}

struct BrowserQueryTelemetry(Function);

impl QueryTelemetry for BrowserQueryTelemetry {
    fn now_ms(&self) -> f64 {
        now_ms()
    }

    fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool) {
        // A broken/throwing JS telemetry sink must never change SQL results.
        let _ = self.0.call3(
            &JsValue::UNDEFINED,
            &JsValue::from_str(fingerprint),
            &JsValue::from_f64(duration_ms),
            &JsValue::from_bool(success),
        );
    }
}

/// Install the worker's payload-free slow SQL callback before opening the cache.
/// Called only for statement executions strictly longer than 200 milliseconds.
#[wasm_bindgen(js_name = setSlowQueryCallback)]
pub fn set_slow_query_callback(callback: Function) {
    set_query_telemetry(Some(Rc::new(BrowserQueryTelemetry(callback))));
}

/// Statement executions and the rows they stepped in this worker since the
/// module loaded, as `{ statements, rows }`. Hosts diff two readings to see
/// how much SQL one engine call cost; nothing about the SQL crosses.
#[wasm_bindgen(js_name = sqlCounters)]
pub fn sql_counters() -> JsValue {
    let counts = cache_turso::query_telemetry::sql_counts();
    let object = js_sys::Object::new();
    // Setting a plain data property on a fresh object cannot throw.
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("statements"),
        &JsValue::from_f64(counts.statements as f64),
    );
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("rows"),
        &JsValue::from_f64(counts.rows as f64),
    );
    object.into()
}
