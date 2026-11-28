use std::rc::Rc;

use cache_turso::query_telemetry::{
    CappedCheckpoint, QueryTelemetry, StorageIo, commit_totals, set_query_telemetry,
};
use js_sys::{Function, Object, Reflect};
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

struct BrowserQueryTelemetry {
    slow_query: Function,
    capped_checkpoint: Option<Function>,
}

fn opfs_io() -> StorageIo {
    let totals = turso_opfs::io_totals();
    StorageIo {
        writes: totals.writes,
        write_bytes: totals.write_bytes,
        write_ms: totals.write_ms,
        flushes: totals.flushes,
        flush_ms: totals.flush_ms,
    }
}

/// `{ writeMs, writeBytes, writes, flushMs, flushes }`; counts stay far below
/// 2^53.
fn io_object(io: StorageIo) -> Object {
    let object = Object::new();
    for (key, value) in [
        ("writes", io.writes as f64),
        ("writeBytes", io.write_bytes as f64),
        ("writeMs", io.write_ms),
        ("flushes", io.flushes as f64),
        ("flushMs", io.flush_ms),
    ] {
        let _ = Reflect::set(&object, &JsValue::from_str(key), &JsValue::from_f64(value));
    }
    object
}

impl QueryTelemetry for BrowserQueryTelemetry {
    fn now_ms(&self) -> f64 {
        now_ms()
    }

    fn storage_io(&self) -> StorageIo {
        opfs_io()
    }

    fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool, io: StorageIo) {
        let arguments = js_sys::Array::of4(
            &JsValue::from_str(fingerprint),
            &JsValue::from_f64(duration_ms),
            &JsValue::from_bool(success),
            &io_object(io),
        );
        // A broken/throwing JS telemetry sink must never change SQL results.
        let _ = self.slow_query.apply(&JsValue::UNDEFINED, &arguments);
    }

    fn capped_checkpoint(&self, checkpoint: CappedCheckpoint) {
        let Some(callback) = &self.capped_checkpoint else {
            return;
        };
        let object = io_object(checkpoint.io);
        for (key, value) in [
            ("durationMs", JsValue::from_f64(checkpoint.duration_ms)),
            ("success", JsValue::from_bool(checkpoint.success)),
            ("walFrames", JsValue::from_f64(checkpoint.wal_frames as f64)),
            (
                "backfilledFrames",
                JsValue::from_f64(checkpoint.backfilled_frames as f64),
            ),
        ] {
            let _ = Reflect::set(&object, &JsValue::from_str(key), &value);
        }
        // As above, a throwing sink never reaches the write that committed.
        let _ = callback.call1(&JsValue::UNDEFINED, &object);
    }
}

/// Install the worker's payload-free storage telemetry before opening the
/// cache. `slow_query` is called only for statement executions strictly
/// longer than 200 milliseconds, with the OPFS writes and flushes made during
/// them; `capped_checkpoint` for each WAL copy run right after the COMMIT that
/// took the WAL to its cap.
#[wasm_bindgen(js_name = setSlowQueryCallback)]
pub fn set_slow_query_callback(slow_query: Function, capped_checkpoint: Option<Function>) {
    set_query_telemetry(Some(Rc::new(BrowserQueryTelemetry {
        slow_query,
        capped_checkpoint,
    })));
}

/// The COMMITs that wrote and the OPFS writes and flushes made so far on this
/// worker: `{ commits, commitMs, writeMs, writeBytes, writes, flushMs, flushes }`.
#[wasm_bindgen(js_name = storageIoTotals)]
pub fn storage_io_totals() -> JsValue {
    let commits = commit_totals();
    let object = io_object(opfs_io());
    let _ = Reflect::set(
        &object,
        &JsValue::from_str("commits"),
        &JsValue::from_f64(commits.commits as f64),
    );
    let _ = Reflect::set(
        &object,
        &JsValue::from_str("commitMs"),
        &JsValue::from_f64(commits.commit_ms),
    );
    object.into()
}
