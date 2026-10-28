//! Calendar range reads and commits over the native range index.

use super::{EngineHandle, EngineState, WriteResultWire, wire_write_result};
use cache_core::calendar::{CalendarCommit, CalendarRangeRequest, CalendarRangeResult};
use serde::Serialize;

/// Mirrors the `range` variant of `CalendarRangeCacheResult` in
/// `apps/web/src/lib/graphql-cache/protocol.ts`.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CalendarRangeResultWire {
    /// The engine answered the viewport from its range index.
    Range {
        /// Revision observed by the read.
        revision: String,
        /// Keys, gaps, freshness, uncertainty, and watermark.
        #[serde(flatten)]
        result: CalendarRangeResult,
    },
}

impl EngineHandle {
    /// Answers a calendar viewport from cached occurrences.
    pub async fn calendar_range(
        &self,
        request: CalendarRangeRequest,
    ) -> Result<CalendarRangeResultWire, String> {
        self.inner
            .lock()
            .await
            .engine
            .calendar_range(&request)
            .await
            .map(|result| CalendarRangeResultWire::Range {
                revision: result.revision.to_string(),
                result: result.value,
            })
            .map_err(|error| error.to_string())
    }

    /// Applies a calendar commit atomically.
    pub async fn calendar_commit(&self, commit: CalendarCommit) -> Result<WriteResultWire, String> {
        let mut state = self.inner.lock().await;
        let EngineState { engine, ops, .. } = &mut *state;
        let result = engine
            .calendar_commit(&commit)
            .await
            .map_err(|error| error.to_string())?;
        Ok(wire_write_result(ops, result))
    }
}
