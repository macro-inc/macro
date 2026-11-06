//! The production [`Replica`]: a Loro document plus an ephemeral presence
//! store. A direct port of the wasm sync-service's `DocumentState`
//! (import/export/diff and the blame-node walk) off the `worker` runtime.

#[cfg(test)]
mod test;

use crate::replica::{Applied, Replica};
use loro::awareness::EphemeralStore;
use loro::{Container, ContainerID, ExportMode, Frontiers, LoroDoc, LoroValue, VersionVector};
use std::borrow::Cow;

/// Import tag distinguishing peer traffic in Loro's change metadata.
const FROM_CLIENT_TAG: &str = "from_client";
/// Import tag for snapshots loaded from storage.
const FROM_SERVICE_TAG: &str = "from_service";

/// Presence entries expire after this long without an update, matching the
/// wasm service's `EphemeralStore::new(5_000)`.
const PRESENCE_TTL_MS: i64 = 5_000;

/// Real Lexical docs never nest deeply; cap the blame walk as a safety net
/// against unexpectedly large container paths.
const MAX_BLAME_WALK_DEPTH: usize = 100;

/// Errors surfaced by [`LoroReplica`].
#[derive(Debug, thiserror::Error)]
pub enum LoroReplicaError {
    /// Loro rejected the payload.
    #[error("loro error: {0}")]
    Loro(#[from] loro::LoroError),
    /// Loro failed to export the requested range.
    #[error("loro encode error: {0}")]
    Encode(#[from] loro::LoroEncodeError),
    /// A snapshot imported with parts left pending (missing dependencies).
    #[error("snapshot import left pending changes")]
    IncompleteSnapshot,
}

/// See the module docs.
pub struct LoroReplica {
    doc: LoroDoc,
    presence: EphemeralStore,
}

impl Replica for LoroReplica {
    type Error = LoroReplicaError;

    fn load(snapshot: &[u8]) -> Result<Self, Self::Error> {
        let doc = LoroDoc::new();
        let status = doc.import_with(snapshot, FROM_SERVICE_TAG)?;
        if status.pending.is_some() {
            return Err(LoroReplicaError::IncompleteSnapshot);
        }
        Ok(Self {
            doc,
            presence: EphemeralStore::new(PRESENCE_TTL_MS),
        })
    }

    fn empty() -> Self {
        Self {
            doc: LoroDoc::new(),
            presence: EphemeralStore::new(PRESENCE_TTL_MS),
        }
    }

    fn apply(&mut self, update: &[u8]) -> Result<Applied, Self::Error> {
        let before = self.doc.oplog_frontiers();
        self.doc.import_with(update, FROM_CLIENT_TAG)?;
        let after = self.doc.oplog_frontiers();
        Ok(Applied {
            touched_nodes: self.touched_lexical_ids(&before, &after),
        })
    }

    fn snapshot(&self) -> Vec<u8> {
        // Exporting into a Vec cannot fail for a healthy document; an export
        // error here would mean corrupted in-memory state, which panicking
        // surfaces louder than any recovery we could attempt.
        self.doc
            .export(ExportMode::Snapshot)
            .expect("exporting a live LoroDoc snapshot")
    }

    fn diff_since(&self, cursor: &[u8]) -> Result<Vec<u8>, Self::Error> {
        let vv = VersionVector::decode(cursor)?;
        Ok(self.doc.export(ExportMode::Updates {
            from: Cow::Owned(vv),
        })?)
    }

    fn apply_presence(&mut self, payload: &[u8]) {
        // Invalid presence is dropped, never fatal — matches the service.
        if let Err(error) = self.presence.apply(payload) {
            tracing_unavailable_noop(&error);
        }
    }

    fn presence_all(&self) -> Vec<u8> {
        self.presence.encode_all()
    }

    fn remove_presence(&mut self, peer_ids: &[u64]) -> Option<Vec<u8>> {
        if peer_ids.is_empty() {
            return None;
        }
        // Delete each peer's entry, then encode the tombstoned keys so other
        // clients observe the removal — the wasm service's websocket_close.
        let mut deltas = Vec::new();
        for peer in peer_ids {
            let key = peer.to_string();
            self.presence.delete(&key);
            deltas.push(self.presence.encode(&key));
        }
        // Concatenated ephemeral updates apply independently client-side;
        // send the last one when single (the common case) to keep it exact.
        match deltas.len() {
            1 => deltas.pop(),
            _ => Some(deltas.concat()),
        }
    }
}

/// This crate stays tracing-free (pure core); the runtime observes presence
/// errors at the effect boundary if it cares.
fn tracing_unavailable_noop<E: core::fmt::Debug>(_error: &E) {}

impl LoroReplica {
    /// Diff the two frontiers and return the Lexical node ids whose backing
    /// containers changed, deduplicated. Empty on diff failure.
    fn touched_lexical_ids(&self, before: &Frontiers, after: &Frontiers) -> Vec<String> {
        let Ok(diff) = self.doc.diff(before, after) else {
            return Vec::new();
        };
        let mut touched: Vec<String> = diff
            .iter()
            .filter_map(|(container_id, _)| self.find_lexical_id(container_id))
            .collect();
        touched.sort();
        touched.dedup();
        touched
    }

    /// Walk from a changed container up to the nearest ancestor LoroMap whose
    /// `$` submap has an `id` — that string is the Lexical node id.
    fn find_lexical_id(&self, container_id: &ContainerID) -> Option<String> {
        let mut candidates: Vec<ContainerID> = vec![container_id.clone()];
        if let Some(path) = self.doc.get_path_to_container(container_id) {
            for (candidate, _) in path.into_iter().rev() {
                candidates.push(candidate);
            }
        }

        for candidate in candidates.into_iter().take(MAX_BLAME_WALK_DEPTH) {
            let Some(container) = self.doc.get_container(candidate) else {
                continue;
            };
            let Container::Map(map) = container else {
                continue;
            };
            let Some(meta) = map.get("$") else {
                continue;
            };
            let Ok(Container::Map(meta_map)) = meta.into_container() else {
                continue;
            };
            let Some(id_value) = meta_map.get("id") else {
                continue;
            };
            let Ok(LoroValue::String(id)) = id_value.into_value() else {
                continue;
            };
            return Some(id.to_string());
        }
        None
    }
}
