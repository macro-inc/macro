//! Calendar range reads and commits over the local range index.

use super::{CacheEngine, err_js, js_write_result, to_js};
use cache_core::calendar::{CalendarCommit, CalendarRangeRequest, CalendarRangeResult};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JsCalendarRangeResult {
    pub(super) kind: &'static str,
    pub(super) revision: String,
    #[serde(flatten)]
    pub(super) result: CalendarRangeResult,
}

#[wasm_bindgen]
impl CacheEngine {
    /// Answers a calendar viewport from cached occurrences, reporting the
    /// spans that were never fetched and the applied change watermark.
    #[wasm_bindgen(js_name = calendarRange)]
    pub fn calendar_range(&self, request: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request: CalendarRangeRequest =
                serde_wasm_bindgen::from_value(request).map_err(err_js)?;
            let result = state.engine_mut()?.calendar_range(&request).await;
            let result = state.engine_result(result)?;
            to_js(&JsCalendarRangeResult {
                kind: "range",
                revision: result.revision.to_string(),
                result: result.value,
            })
        })
    }

    /// Atomically applies fetched coverage, delta deletions, and sync state.
    /// Resolves like `writeQuery` so hosts fan out the deleted records.
    #[wasm_bindgen(js_name = calendarCommit)]
    pub fn calendar_commit(&self, commit: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let commit: CalendarCommit = serde_wasm_bindgen::from_value(commit).map_err(err_js)?;
            let result = state.engine_mut()?.calendar_commit(&commit).await;
            let result = state.engine_result(result)?;
            to_js(&js_write_result(result, &ops.borrow()))
        })
    }
}
