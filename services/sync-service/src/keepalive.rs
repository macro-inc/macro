use std::time::Duration;
use tracing::trace;
use worker::{
    js_sys,
    wasm_bindgen::{JsCast, prelude::Closure},
};

use crate::error::ResultExt;
use std::cell::Cell;

pub const DEFAULT_TIME_TO_LIVE: Duration = Duration::from_secs(60);

thread_local! { static CURRENT_TIMEOUT_ID: Cell<Option<(i32, i32)>> = const { Cell::new(None) }; }

/// Keeps the worker alive for at least `ttl: Duration` using JavaScript's `setTimeout`.
/// It replaces any existing ttl, and returns the `setTimeout`'s timeout ID.
pub fn keepalive(ttl: Duration) -> Option<(i32, i32)> {
    let closure = Closure::wrap(Box::new(move || {
        CURRENT_TIMEOUT_ID.set(None);
    }) as Box<dyn FnMut()>);

    let global: worker::worker_sys::web_sys::WorkerGlobalScope = js_sys::global().unchecked_into();

    let mut out = None;
    let current_id = CURRENT_TIMEOUT_ID.get();

    if let Some((prev_timeout_id, prev_duration_millis)) = current_id {
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
        CURRENT_TIMEOUT_ID.set(Some((timeout_id, duration_millis)));
    }

    closure.forget();
    out
}
