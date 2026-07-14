use std::time::Duration;
use tracing::trace;
use worker::{
    js_sys,
    wasm_bindgen::{JsCast, prelude::Closure},
};

use crate::{error::ResultExt, mutex::Mutex};

pub const DEFAULT_TIME_TO_LIVE: Duration = Duration::from_secs(60);

static CURRENT_TIMEOUT_ID: Mutex<Option<(i32, i32)>> = Mutex::new(None);

/// Keeps the worker alive for at least `ttl: Duration` using JavaScript's `setTimeout`.
/// It replaces any existing ttl, and returns the `setTimeout`'s timeout ID.
pub fn keepalive(ttl: Duration) -> Option<(i32, i32)> {
    let closure = Closure::wrap(Box::new(move || {
        *CURRENT_TIMEOUT_ID.lock("keepalive clear CURRENT_TIMEOUT_ID") = None;
    }) as Box<dyn FnMut()>);

    let global: worker::worker_sys::web_sys::WorkerGlobalScope = js_sys::global().unchecked_into();

    let mut out = None;
    let mut current_id = CURRENT_TIMEOUT_ID.lock("keepalive set CURRENT_TIMEOUT_ID");

    if let Some((prev_timeout_id, prev_duration_millis)) = *current_id {
        global.clear_timeout_with_handle(prev_timeout_id);
        out = Some((prev_timeout_id, prev_duration_millis));
    }

    let duration_millis = ttl.as_millis() as i32;
    if let Ok(timeout_id) = global
        .set_timeout_with_callback_and_timeout_and_arguments_0(
            closure.as_ref().unchecked_ref(),
            duration_millis,
        )
        .context("Failed to create timeout. Something really weird is happening")
    {
        trace!(
            timeout_id = timeout_id,
            timeout_duration_ms = duration_millis,
            "created set_timeout"
        );
        *current_id = Some((timeout_id, duration_millis));
    }

    closure.forget();
    out
}
