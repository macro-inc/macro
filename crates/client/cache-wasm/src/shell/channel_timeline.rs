//! Channel timeline page reads, commits and eviction over the local index.

use super::{CacheEngine, JsWriteResult, err_js, js_write_result, to_js};
use cache_core::channel_timeline::{
    ChannelEviction, ChannelTimelineCommit, ChannelTimelineRequest, ChannelTimelineResult,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsChannelTimelineResult {
    kind: &'static str,
    revision: String,
    #[serde(flatten)]
    result: ChannelTimelineResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsChannelCommitResult {
    #[serde(flatten)]
    write: JsWriteResult,
    channel_seq: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsChannelEvictionResult {
    #[serde(flatten)]
    write: JsWriteResult,
    channel_ids: Vec<String>,
    has_more: bool,
}

#[wasm_bindgen]
impl CacheEngine {
    /// Answers one channel or thread page from cached messages, or reports
    /// that the requested window was never fully fetched.
    #[wasm_bindgen(js_name = channelTimeline)]
    pub fn channel_timeline(&self, request: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let request: ChannelTimelineRequest =
                serde_wasm_bindgen::from_value(request).map_err(err_js)?;
            let result = state.engine_mut()?.channel_timeline(&request).await;
            let result = state.engine_result(result)?;
            to_js(&JsChannelTimelineResult {
                kind: "page",
                revision: result.revision.to_string(),
                result: result.value,
            })
        })
    }

    /// Atomically applies fetched coverage, deletions and the applied change
    /// sequence of one channel. Resolves like `writeQuery`, plus the
    /// channel's sequence after the commit.
    #[wasm_bindgen(js_name = channelTimelineCommit)]
    pub fn channel_timeline_commit(&self, commit: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let commit: ChannelTimelineCommit =
                serde_wasm_bindgen::from_value(commit).map_err(err_js)?;
            let result = state.engine_mut()?.channel_timeline_commit(&commit).await;
            let result = state.engine_result(result)?;
            let unchanged_views = state
                .engine_mut()?
                .unchanged_observed_windows()
                .await
                .unwrap_or_default();
            let mut write = js_write_result(result.write, &ops.borrow());
            write.unchanged_views = Some(unchanged_views);
            to_js(&JsChannelCommitResult {
                write,
                channel_seq: result.seq,
            })
        })
    }

    /// Removes the channels touched longest ago with their messages.
    #[wasm_bindgen(js_name = channelTimelineEvict)]
    pub fn channel_timeline_evict(&self, eviction: JsValue) -> js_sys::Promise {
        let state = self.state.clone();
        let ops = self.ops.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let eviction: ChannelEviction =
                serde_wasm_bindgen::from_value(eviction).map_err(err_js)?;
            let result = state.engine_mut()?.channel_timeline_evict(&eviction).await;
            let result = state.engine_result(result)?;
            let unchanged_views = state
                .engine_mut()?
                .unchanged_observed_windows()
                .await
                .unwrap_or_default();
            let mut write = js_write_result(result.write, &ops.borrow());
            write.unchanged_views = Some(unchanged_views);
            to_js(&JsChannelEvictionResult {
                write,
                channel_ids: result.channel_ids,
                has_more: result.has_more,
            })
        })
    }

    /// Counts the channels and entries the timeline index holds.
    #[wasm_bindgen(js_name = channelTimelineStats)]
    pub fn channel_timeline_stats(&self) -> js_sys::Promise {
        let state = self.state.clone();
        future_to_promise(async move {
            let mut state = state.lock().await;
            state.ensure_callable()?;
            let result = state.engine_mut()?.channel_timeline_stats().await;
            to_js(&state.engine_result(result)?)
        })
    }
}
