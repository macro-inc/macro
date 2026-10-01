use std::sync::Mutex;

use automerge::{Automerge, ChangeHash, ROOT, ReadDoc};
use web_time::Instant;
use worker::Result;

use crate::{domain::crdt::decode_changes, error::ResultExt};

#[cfg(test)]
mod test;

pub struct ImportedUpdate {
    pub changed: bool,
    pub touched_nodes: Vec<String>,
}

#[derive(Debug)]
pub struct DocumentState {
    pub document: Mutex<Automerge>,
    pub last_update: Mutex<Option<Instant>>,
    pub last_export: Mutex<Option<Instant>>,
}

impl DocumentState {
    pub fn new() -> Self {
        Self::from_document(Automerge::new())
    }

    fn from_document(document: Automerge) -> Self {
        Self {
            document: Mutex::new(document),
            last_update: Mutex::new(None),
            last_export: Mutex::new(None),
        }
    }

    pub fn try_from_snapshot(snapshot: &[u8]) -> Result<Self> {
        // Strict loading preserves existing stored bytes on incompatible or
        // malformed snapshots. Never replace a failed load with an empty doc.
        let document = Automerge::load(snapshot).context("invalid Automerge snapshot")?;
        if !document.get_missing_deps(&[]).is_empty() {
            return Err(worker::Error::from("snapshot has missing dependencies"));
        }
        Ok(Self::from_document(document))
    }

    pub fn heads(&self) -> Vec<ChangeHash> {
        self.document
            .lock()
            .unwrap_context("document mutex poisoned")
            .get_heads()
    }

    pub fn contains_heads(&self, heads: &[ChangeHash]) -> bool {
        let doc = self
            .document
            .lock()
            .unwrap_context("document mutex poisoned");
        heads
            .iter()
            .all(|head| doc.get_change_by_hash(head).is_some())
    }

    pub fn frontiers(&self) -> (Vec<ChangeHash>, Vec<ChangeHash>) {
        let heads = self.heads();
        (heads.clone(), heads)
    }

    pub fn get_json(&self) -> String {
        let doc = self
            .document
            .lock()
            .unwrap_context("document mutex poisoned");
        let native = serde_json::to_value(automerge::AutoSerde::from(&*doc))
            .expect("Automerge JSON is serializable");
        crate::domain::crdt::materialize_json(native).to_string()
    }

    pub fn should_save(&self) -> bool {
        let Some(update) = *self
            .last_update
            .lock()
            .unwrap_context("last_update mutex poisoned")
        else {
            return false;
        };
        self.last_export
            .lock()
            .unwrap_context("last_export mutex poisoned")
            .is_none_or(|export| update > export)
    }

    pub fn mark_exported(&self) {
        *self
            .last_export
            .lock()
            .unwrap_context("last_export mutex poisoned") = Some(Instant::now());
    }

    pub fn import(&self, update: &[u8]) -> Result<ImportedUpdate> {
        self.import_batch(&[update])
    }

    pub fn import_batch(&self, updates: &[&[u8]]) -> Result<ImportedUpdate> {
        let changes = updates
            .iter()
            .map(|update| decode_changes(update))
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("invalid Automerge updates")?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let mut doc = self
            .document
            .lock()
            .unwrap_context("document mutex poisoned");
        let before = doc.get_heads();
        let mut preview = doc.clone();
        let mut patches = automerge::PatchLog::active();
        preview
            .apply_changes_log_patches(changes, &mut patches)
            .context("failed to apply Automerge changes")?;
        if !preview.get_missing_deps(&[]).is_empty() {
            return Err(worker::Error::from("update has missing dependencies"));
        }
        let after = preview.get_heads();
        let mut touched_nodes = Vec::new();
        for patch in preview.make_patches(&mut patches) {
            for object in
                std::iter::once(&patch.obj).chain(patch.path.iter().rev().map(|(obj, _)| obj))
            {
                if *object == ROOT {
                    continue;
                }
                if let Ok(Some((automerge::Value::Object(_), meta))) = preview.get(object, "$") {
                    if let Ok(Some((value, id_object))) = preview.get(meta, "id") {
                        let id = match value {
                            automerge::Value::Object(automerge::ObjType::Text) => {
                                preview.text(id_object).ok()
                            }
                            _ => value.as_str().map(ToOwned::to_owned),
                        };
                        if let Some(id) = id {
                            touched_nodes.push(id);
                            break;
                        }
                    }
                }
            }
        }
        touched_nodes.sort();
        touched_nodes.dedup();
        *doc = preview;
        if before != after {
            *self
                .last_update
                .lock()
                .unwrap_context("last_update mutex poisoned") = Some(Instant::now());
        }
        Ok(ImportedUpdate {
            changed: before != after,
            touched_nodes,
        })
    }

    pub fn export_snapshot(&self, heads: Option<Vec<ChangeHash>>) -> Result<Vec<u8>> {
        let doc = self
            .document
            .lock()
            .unwrap_context("document mutex poisoned");
        match heads {
            Some(heads) => Ok(doc
                .fork_at(&heads)
                .context("unknown snapshot revision")?
                .save()),
            None => Ok(doc.save()),
        }
    }

    pub fn export_shallow_snapshot(&self) -> Result<Vec<u8>> {
        // Automerge snapshots retain causal history; dropping it would break
        // offline edits, historical copies, and incremental synchronization.
        self.export_snapshot(None)
    }

    pub fn version_id(&self) -> String {
        self.heads()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|")
    }

    pub fn export_updates_since(&self, heads: &[ChangeHash]) -> Result<Vec<u8>> {
        // Unknown heads can come from offline edits: include the full history
        // so the peer can converge without discarding its unacknowledged work.
        let doc = self
            .document
            .lock()
            .unwrap_context("document mutex poisoned");
        let known: Vec<_> = heads
            .iter()
            .filter(|head| doc.get_change_by_hash(head).is_some())
            .copied()
            .collect();
        Ok(doc.save_after(&known))
    }

    pub fn replay_pending_operations(&self, updates: &[Vec<u8>]) -> Result<()> {
        // Replay as one batch: durable log ordering need not be causal.
        let changes = updates
            .iter()
            .map(|update| decode_changes(update))
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("invalid pending changes")?;
        let mut doc = self
            .document
            .lock()
            .unwrap_context("document mutex poisoned");
        let mut preview = doc.clone();
        preview
            .apply_changes(changes.into_iter().flatten().collect::<Vec<_>>())
            .context("replay pending changes")?;
        if !preview.get_missing_deps(&[]).is_empty() {
            return Err(worker::Error::from(
                "pending changes have missing dependencies",
            ));
        }
        *doc = preview;
        Ok(())
    }
}
