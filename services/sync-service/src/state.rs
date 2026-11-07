//! Temporary shared-state adapter while session memory moves into the core.
use loro::{ExportMode, Frontiers, LoroDoc, VersionVector};
use std::cell::{Cell, RefCell};
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

#[derive(Debug)]
pub struct DocumentState {
    // LoroDoc::clone shares the same document; retain the old read-only caller API
    // while only the timestamp-owning core state needs the temporary RefCell.
    pub loro_doc: LoroDoc,
    inner: RefCell<CoreDocumentState>,
}

impl DocumentState {
    fn wrap(inner: CoreDocumentState) -> Self {
        Self {
            loro_doc: inner.loro_doc.clone(),
            inner: RefCell::new(inner),
        }
    }

    pub fn new() -> Self {
        Self::wrap(CoreDocumentState::new())
    }
    pub fn try_from_snapshot(snapshot: &[u8]) -> Result<Self> {
        into_worker(CoreDocumentState::try_from_snapshot(snapshot)).map(Self::wrap)
    }
    pub fn frontiers(&self) -> (Frontiers, Frontiers) {
        self.inner.borrow().frontiers()
    }
    pub fn get_json(&self) -> String {
        self.inner.borrow().get_json()
    }
    pub fn should_save(&self) -> bool {
        self.inner.borrow().should_save()
    }
    pub fn mark_exported(&self) {
        self.inner.borrow_mut().mark_exported(monotonic());
    }
    pub fn import(&self, update: &[u8]) -> Result<ImportedUpdate> {
        into_worker(self.inner.borrow_mut().import_with_clock(update, monotonic))
    }
    pub fn root_change(&self, updates: &[&[u8]]) -> Result<Option<RootChange>> {
        into_worker(self.inner.borrow().root_change(updates))
    }
    pub fn export_snapshot(&self, mode: Option<ExportMode>) -> Result<Vec<u8>> {
        into_worker(self.inner.borrow().export_snapshot(mode))
    }
    pub fn export_shallow_snapshot(&self) -> Result<Vec<u8>> {
        into_worker(self.inner.borrow().export_shallow_snapshot())
    }
    pub fn version_id(&self) -> String {
        self.inner.borrow().version_id()
    }
    pub fn export_updates_since(&self, vv: &VersionVector) -> Result<Vec<u8>> {
        into_worker(self.inner.borrow().export_updates_since(vv))
    }
    pub fn replay_pending_operations(&self, updates: &[Vec<u8>]) -> Result<()> {
        into_worker(self.inner.borrow_mut().replay_pending_operations(updates))
    }
}
