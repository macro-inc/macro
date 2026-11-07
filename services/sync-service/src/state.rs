//! Read-only Loro views for the Worker adapter; mutable state belongs to Room.
use loro::{ExportMode, LoroDoc};
use std::cell::Cell;
use std::time::Duration;
use sync_server_core::domain::{
    state::DocumentState as CoreDocumentState, state_error::StateError,
};
use web_time::Instant;
use worker::Result;

pub use sync_server_core::domain::state::{ImportedUpdate, RootChange};

thread_local! {
    static MONOTONIC_ORIGIN: Cell<Option<Instant>> = const { Cell::new(None) };
}

pub(crate) fn monotonic() -> Duration {
    let instant = Instant::now();
    #[cfg(feature = "transcript")]
    let instant = crate::transcript::instant("state_instant", instant);
    MONOTONIC_ORIGIN.with(|origin| {
        let first = origin.get().unwrap_or(instant);
        origin.set(Some(first));
        instant.duration_since(first)
    })
}

fn into_worker<T>(result: std::result::Result<T, StateError>) -> Result<T> {
    result.map_err(|error| worker::Error::from(error.to_string()))
}

/// Read-only handle for adapter exports. Timestamp mutation belongs to Room.
#[derive(Debug)]
pub struct DocumentState {
    pub loro_doc: LoroDoc,
    inner: CoreDocumentState,
}
impl DocumentState {
    pub(crate) fn view(inner: &CoreDocumentState) -> Self {
        Self::from_core(CoreDocumentState {
            loro_doc: inner.loro_doc.clone(),
            last_update: inner.last_update,
            last_export: inner.last_export,
        })
    }
    pub(crate) fn from_core(inner: CoreDocumentState) -> Self {
        Self {
            loro_doc: inner.loro_doc.clone(),
            inner,
        }
    }
    pub fn try_from_snapshot(snapshot: &[u8]) -> Result<Self> {
        into_worker(CoreDocumentState::try_from_snapshot(snapshot)).map(Self::from_core)
    }

    pub fn get_json(&self) -> String {
        self.inner.get_json()
    }

    pub fn export_snapshot(&self, mode: Option<ExportMode>) -> Result<Vec<u8>> {
        into_worker(self.inner.export_snapshot(mode))
    }
    pub fn export_shallow_snapshot(&self) -> Result<Vec<u8>> {
        into_worker(self.inner.export_shallow_snapshot())
    }
}
