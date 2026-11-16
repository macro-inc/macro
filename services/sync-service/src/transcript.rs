//! Test-only observation of the existing worker boundary. Never deploy this feature.

use wasm_bindgen::{JsCast, closure::Closure, prelude::*};
use worker::{Env, State, js_sys};

#[wasm_bindgen(inline_js = "
export function observePorts(state, env, emit) {
    return globalThis.__syncObservePorts(state, env, emit);
}
export function getCallback(room) { return globalThis.__syncGetCallback(room); }
export function enterCallback(room, callback) { return globalThis.__syncEnterCallback(room, callback); }
export function leaveCallback(previous) { globalThis.__syncLeaveCallback(previous); }
export function clockRead(room, kind, value) {
    globalThis.__syncClockRead(room, kind, value);
}")]
extern "C" {
    #[wasm_bindgen(js_name = observePorts)]
    fn observe_ports(state: &JsValue, env: &JsValue, emit: &JsValue) -> js_sys::Array;
    #[wasm_bindgen(js_name = clockRead)]
    fn clock_read(room: &str, kind: &str, value: &JsValue);
    #[wasm_bindgen(js_name = getCallback)]
    fn get_callback(room: &str) -> u32;
    #[wasm_bindgen(js_name = enterCallback)]
    fn enter_callback(room: &str, callback: u32) -> JsValue;
    #[wasm_bindgen(js_name = leaveCallback)]
    fn leave_callback(previous: JsValue);
}

/// Preserve the native receivers while observing calls at the JS host boundary.
pub(crate) fn observe(state: State, env: Env) -> (State, Env) {
    let emit = Closure::<dyn Fn(String)>::new(|line: String| {
        tracing::info!(target: "sync_transcript", transcript = %line);
    });
    let raw = state._inner();
    let observed = observe_ports(raw.as_ref(), env.as_ref(), emit.as_ref());
    emit.forget();
    (
        State::from(
            observed
                .get(0)
                .unchecked_into::<worker::worker_sys::DurableObjectState>(),
        ),
        observed.get(1).unchecked_into(),
    )
}

/// Record the value already read, without substituting or adding a clock read.
pub(crate) fn clock(kind: &str, value: impl ToString) {
    #[cfg(target_arch = "wasm32")]
    CURRENT_ROOM.with(|room| {
        if let Some(room) = room.borrow().as_ref() {
            clock_read(room, kind, &JsValue::from_str(&value.to_string()));
        }
    });
    #[cfg(not(target_arch = "wasm32"))]
    let _ = (kind, value);
}

thread_local! {
    static CURRENT_ROOM: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
    static CURRENT_CALLBACK: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static INSTANT_ORIGIN: std::cell::Cell<Option<web_time::Instant>> = const { std::cell::Cell::new(None) };
}

/// Carry the room across every poll, including after awaited host calls.
pub(crate) fn scope<T>(
    room: String,
    future: impl std::future::Future<Output = T>,
) -> impl std::future::Future<Output = T> {
    let callback = get_callback(&room);
    scoped(room, callback, future)
}

async fn scoped<T>(room: String, callback: u32, future: impl std::future::Future<Output = T>) -> T {
    let mut future = std::pin::pin!(future);
    futures::future::poll_fn(|context| {
        let previous = CURRENT_ROOM.with(|current| current.replace(Some(room.clone())));
        let previous_callback = CURRENT_CALLBACK.with(|current| current.replace(callback));
        let js_previous = enter_callback(&room, callback);
        let result = future.as_mut().poll(context);
        leave_callback(js_previous);
        CURRENT_CALLBACK.with(|current| current.set(previous_callback));
        CURRENT_ROOM.with(|current| current.replace(previous));
        result
    })
    .await
}

/// Preserve originating callback attribution when a wait_until future is polled.
pub(crate) fn background(
    future: impl std::future::Future<Output = ()>,
) -> impl std::future::Future<Output = ()> {
    let room = CURRENT_ROOM.with(|current| current.borrow().clone());
    let callback = CURRENT_CALLBACK.with(|current| current.get());
    async move {
        match room {
            Some(room) => scoped(room, callback, future).await,
            None => future.await,
        }
    }
}

/// Observe an existing monotonic instant relative to the first observed instant.
pub(crate) fn instant(kind: &str, value: web_time::Instant) -> web_time::Instant {
    INSTANT_ORIGIN.with(|origin| {
        let first = origin.get().unwrap_or(value);
        origin.set(Some(first));
        clock(kind, value.duration_since(first).as_nanos());
    });
    value
}

/// Record an outbound boundary with its current callback context.
pub(crate) fn event(event: serde_json::Value) {
    CURRENT_ROOM.with(|current| {
        let mut event = event;
        event["room"] = serde_json::json!(*current.borrow());
        event["callback"] = serde_json::json!(CURRENT_CALLBACK.with(|current| current.get()));
        tracing::info!(target: "sync_transcript", transcript = %event);
    });
}
