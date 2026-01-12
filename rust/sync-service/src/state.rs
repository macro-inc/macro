use std::{borrow::Cow, sync::Mutex};

use loro::{ExportMode, Frontiers, LoroDoc, ToJson};
use tracing::debug;
use web_time::Instant;
use worker::Result;

use crate::error::ResultExt;

const FROM_CLIENT_TAG: &str = "from_client";
const FROM_SERVICE_TAG: &str = "from_service";
const FRONTIERS_ID_SEPERATOR: &str = "|";

#[derive(Debug)]
pub struct DocumentState {
    pub loro_doc: LoroDoc,
    pub last_update: Mutex<Option<Instant>>,
    pub last_export: Mutex<Option<Instant>>,
}

impl DocumentState {
    pub fn new() -> Self {
        Self {
            loro_doc: LoroDoc::new(),
            last_update: Mutex::new(None),
            last_export: Mutex::new(None),
        }
    }

    /// Initialize the document state from a snapshot
    pub fn try_from_snapshot(snapshot: &[u8]) -> Result<Self> {
        let loro_doc = LoroDoc::new();
        let status = loro_doc
            .import_with(snapshot, FROM_SERVICE_TAG)
            .context("failed to import snapshot")?;

        let (sf, of) = (loro_doc.state_frontiers(), loro_doc.state_frontiers());
        debug!(state_frontiers =? sf, oplog_frontiers =? of,"loaded new DocumentState");
        if status.pending.is_some() {
            return Err(worker::Error::from("failed to import snapshot"));
        }

        Ok(Self {
            loro_doc,
            last_update: Mutex::new(None),
            last_export: Mutex::new(None),
        })
    }

    /// Get: `(state_frontiers, oplog_frotiers)`
    pub fn frontiers(&self) -> (Frontiers, Frontiers) {
        (
            self.loro_doc.state_frontiers(),
            self.loro_doc.oplog_frontiers(),
        )
    }

    pub fn get_json(&self) -> String {
        self.loro_doc.get_deep_value().to_json()
    }
    pub fn should_save(&self) -> bool {
        let Some(up) = *self
            .last_update
            .lock()
            .unwrap_context("last_update mutex poisoned")
        else {
            return false;
        };
        match *self
            .last_export
            .lock()
            .unwrap_context("last_export mutex poisoned")
        {
            Some(exp) => up > exp,
            None => true,
        }
    }

    pub fn mark_exported(&self) {
        *self
            .last_export
            .lock()
            .unwrap_context("last_export mutex poisoned") = Some(Instant::now());
    }

    /// Import a new update into the document state
    pub fn import(&self, update: &[u8]) -> Result<()> {
        self.loro_doc
            .import_with(update, FROM_CLIENT_TAG)
            .context("failed to import update")?;
        *self
            .last_update
            .lock()
            .unwrap_context("last_update mutex poisoned") = Some(Instant::now());

        Ok(())
    }

    /// Export the document state as a snapshot
    pub fn export_snapshot(&self, export_mode: Option<ExportMode>) -> Result<Vec<u8>> {
        let export_mode = export_mode.unwrap_or(ExportMode::Snapshot);
        self.loro_doc
            .export(export_mode)
            .context("failed to export snapshot")
    }

    pub fn export_shallow_snapshot(&self) -> Result<Vec<u8>> {
        self.loro_doc
            .export(ExportMode::ShallowSnapshot(Cow::Borrowed(
                &self.loro_doc.state_frontiers(),
            )))
            .context("failed to export snapshot")
    }
    pub fn version_id(&self) -> String {
        self.loro_doc
            .state_frontiers()
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(FRONTIERS_ID_SEPERATOR)
    }

    pub fn export_updates_since(&self, frontiers: &Frontiers) -> Result<Vec<u8>> {
        let version_vector = self
            .loro_doc
            .frontiers_to_vv(frontiers)
            .ok_or_else(|| worker::Error::from("failed to convert frontiers to version vector"))?;

        self.loro_doc
            .export(ExportMode::Updates {
                from: std::borrow::Cow::Borrowed(&version_vector),
            })
            .context("failed to export updates")
    }

    /// Batch import a list of pending operations/updates into the document state
    pub fn replay_pending_operations(&self, updates: &[Vec<u8>]) -> Result<()> {
        self.loro_doc
            .import_batch(updates)
            .context("failed to batch import pending updates")?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_snapshot() {
        let loro_doc = LoroDoc::new();
        let text = loro_doc.get_text("content");
        text.push_str("hello world").unwrap();
        let snapshot = loro_doc.export(ExportMode::Snapshot).unwrap();
        let state = DocumentState::try_from_snapshot(snapshot.as_slice()).unwrap();
        let text = state.loro_doc.get_text("content");
        assert_eq!(text.to_string(), "hello world");
    }

    #[test]
    fn test_import_update() {
        let loro_doc = LoroDoc::new();
        let text = loro_doc.get_text("content");
        text.push_str("01").unwrap();

        let initial_snapshot = loro_doc.export(ExportMode::Snapshot).unwrap();

        let state = DocumentState::try_from_snapshot(initial_snapshot.as_slice()).unwrap();

        let state_vv = loro_doc.state_vv();
        text.push_str("234").unwrap();

        let update = loro_doc
            .export(ExportMode::Updates {
                from: std::borrow::Cow::Borrowed(&state_vv),
            })
            .unwrap();

        state.import(update.as_slice()).unwrap();

        let text = state.loro_doc.get_text("content");
        assert_eq!(text.to_string(), "01234");
    }

    #[test]
    fn test_should_save() {
        let loro_doc = LoroDoc::new();
        let text = loro_doc.get_text("content");
        text.push_str("012").unwrap();

        let initial_snapshot = loro_doc.export(ExportMode::Snapshot).unwrap();

        let state = DocumentState::try_from_snapshot(initial_snapshot.as_slice()).unwrap();
        assert!(!state.should_save());

        let state_vv = loro_doc.state_vv();
        text.push_str("234").unwrap();

        let update = loro_doc
            .export(ExportMode::Updates {
                from: std::borrow::Cow::Borrowed(&state_vv),
            })
            .unwrap();

        state.import(update.as_slice()).unwrap();

        assert!(state.should_save());
        // do export here
        state.mark_exported();
        assert!(!state.should_save());
    }

    #[test]
    fn test_replay_pending_operations() {
        let loro_doc = LoroDoc::new();
        let text = loro_doc.get_text("content");
        text.push_str("012").unwrap();

        let initial_snapshot = loro_doc.export(ExportMode::Snapshot).unwrap();

        let state = DocumentState::try_from_snapshot(initial_snapshot.as_slice()).unwrap();

        let mut updates = vec![];

        let version_vector = loro_doc.state_vv();
        text.push_str("3").unwrap();
        updates.push(
            loro_doc
                .export(ExportMode::Updates {
                    from: std::borrow::Cow::Borrowed(&version_vector),
                })
                .unwrap(),
        );

        text.push_str("4").unwrap();
        updates.push(
            loro_doc
                .export(ExportMode::Updates {
                    from: std::borrow::Cow::Borrowed(&version_vector),
                })
                .unwrap(),
        );

        text.push_str("5").unwrap();
        let update5 = loro_doc
            .export(ExportMode::Updates {
                from: std::borrow::Cow::Borrowed(&version_vector),
            })
            .unwrap();

        updates.push(update5.clone());
        // Test to ensure that duplicate updates don't affect the state
        updates.push(update5.clone());

        state.replay_pending_operations(&updates).unwrap();

        let text = state.loro_doc.get_text("content");
        assert_eq!(text.to_string(), "012345");
    }
}
