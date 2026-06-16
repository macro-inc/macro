use std::{borrow::Cow, sync::Mutex};

use loro::{ExportMode, Frontiers, LoroDoc, ToJson, VersionVector, ID};
use tracing::{debug, info};
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

    pub fn export_updates_since(&self, vv: &VersionVector) -> Result<Vec<u8>> {
        self.loro_doc
            .export(ExportMode::Updates {
                from: std::borrow::Cow::Borrowed(vv),
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

    /// All editing sessions over the whole history, most-recent first. Walks the
    /// full oplog (via `travel_change_ancestors` from the frontiers), maps each
    /// change's peer to a user, and groups them with [`crate::sessionize::sessionize`].
    /// `peer_to_user` maps loro peer ids to user ids; unknown peers fall back to
    /// "unknown".
    /// TODO(history): materialize sessions in DO SQLite to avoid walking history per call.
    pub fn history_sessions(
        &self,
        peer_to_user: &std::collections::BTreeMap<u64, String>,
        gap_ms: i64,
    ) -> Vec<crate::sessionize::Session> {
        let mut events: Vec<(String, i64)> = Vec::new();
        let heads: Vec<ID> = self.loro_doc.oplog_frontiers().iter().collect();
        let res = self.loro_doc.travel_change_ancestors(&heads, &mut |change| {
            let user = peer_to_user
                .get(&change.id.peer)
                .map(String::as_str)
                .unwrap_or("unknown");
            events.push((user.to_string(), change.timestamp * 1000));
            std::ops::ControlFlow::Continue(())
        });
        if let Err(error) = res {
            debug!(error =? error, "travel_change_ancestors failed during history_sessions");
        }
        crate::sessionize::sessionize(events, gap_ms)
    }

    /// Version vector containing exactly the changes whose record-timestamp (ms) is
    /// `<= t_ms`. Cheap history walk (no state reconstruction); used to pin the
    /// target version for `state-at(t)`. Returns `None` if the oplog is empty.
    pub fn version_vector_at(&self, t_ms: i64) -> Option<VersionVector> {
        let heads: Vec<ID> = self.loro_doc.oplog_frontiers().iter().collect();
        if heads.is_empty() {
            return None;
        }

        let mut vv = VersionVector::new();
        let mut changes_visited: u64 = 0;
        let mut changes_included: u64 = 0;
        let mut ops_included: u64 = 0;
        let (res, elapsed) = crate::timeit!(self
            .loro_doc
            .travel_change_ancestors(&heads, &mut |change| {
                changes_visited += 1;
                if change.timestamp * 1000 <= t_ms {
                    changes_included += 1;
                    ops_included += change.len as u64;
                    vv.extend_to_include_end_id(ID::new(
                        change.id.peer,
                        change.id.counter + change.len as i32,
                    ));
                }
                // Progress heartbeat: a single summary line only prints once the
                // walk returns, so log as we go to localize a hang inside the walk.
                if changes_visited % 1000 == 0 {
                    info!(
                        changes_visited,
                        changes_included, ops_included, "version_vector_at: walking..."
                    );
                }
                std::ops::ControlFlow::Continue(())
            }));
        info!(
            t_ms,
            changes_visited,
            changes_included,
            ops_included,
            duration_ms = elapsed.as_millis(),
            "version_vector_at: walked oplog ancestors"
        );
        if let Err(error) = res {
            debug!(error =? error, "travel_change_ancestors failed during version_vector_at");
        }
        Some(vv)
    }

    pub fn frontier_ids_at(&self, vv: &VersionVector) -> Vec<(u64, i32)> {
        self.loro_doc
            .vv_to_frontiers(vv)
            .iter()
            .map(|id| (id.peer, id.counter))
            .collect()
    }

    /// State-only snapshot bytes at the version pinned by `vv` (read-only; does not
    /// mutate the live doc).
    pub fn export_state_at_vv(&self, vv: &VersionVector) -> Result<Vec<u8>> {
        let frontiers = self.loro_doc.vv_to_frontiers(vv);
        self.loro_doc
            .export(ExportMode::StateOnly(Some(Cow::Owned(frontiers))))
            .context("failed to export state at version vector")
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
