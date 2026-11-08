//! Independent inputs for development host read callouts.
use crate::*;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct ReadOrigin {
    editor: Arc<()>,
    update: Arc<()>,
}

#[derive(Clone, Copy)]
pub(crate) struct ReadOriginRef<'a> {
    pub editor: &'a Arc<()>,
    pub update: &'a Arc<()>,
}

impl ReadOrigin {
    pub fn borrowed(&self) -> ReadOriginRef<'_> {
        ReadOriginRef {
            editor: &self.editor,
            update: &self.update,
        }
    }
}

impl ReadOriginRef<'_> {
    fn capture(self) -> ReadOrigin {
        ReadOrigin {
            editor: self.editor.clone(),
            update: self.update.clone(),
        }
    }
}

/// Pinned source record identity for a development host's captured node object.
/// Materialized native projections retain the identity of their source record.
#[derive(Clone)]
pub struct ForeignRecordIdentity(Arc<crate::node::NodeSlot>);

impl ForeignRecordIdentity {
    /// Whether a borrowed record is the original captured source record.
    pub fn matches(&self, node: NodeRef<'_>) -> bool {
        std::ptr::eq(&self.0.base, node.base())
    }
}

impl PartialEq for ForeignRecordIdentity {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for ForeignRecordIdentity {}

impl Hash for ForeignRecordIdentity {
    fn hash<H: Hasher>(&self, state: &mut H) {
        std::ptr::hash(Arc::as_ptr(&self.0), state);
    }
}

/// An owned pending or committed read view, independent of its source borrow.
///
/// Pure host callbacks use this capture instead of reading a transaction that
/// is already borrowed by the operation invoking them. A host still needs a
/// separate guarded read dispatcher; this value grants no mutation capability.
pub struct ForeignReadSnapshot {
    state: EditorState,
    previous_selection: Option<Selection>,
    composition_key: Option<NodeKey>,
    source_records: crate::state::NodeMap,
    detached: Vec<Option<Selection>>,
    origin: Option<ReadOrigin>,
}

// Selection::clone models the upstream clone() method, which clears direction
// caches. Capturing a read input must preserve the original object's fields.
fn capture_selection(selection: &Selection) -> Selection {
    let mut captured = selection.clone();
    if let (Selection::Range(source), Selection::Range(target)) = (selection, &mut captured) {
        target.cached_direction = source.cached_direction;
    }
    captured
}

impl Clone for ForeignReadSnapshot {
    fn clone(&self) -> Self {
        let mut state = self.state.clone();
        state.selection = self.state.selection.as_ref().map(capture_selection);
        Self {
            state,
            previous_selection: self.previous_selection.as_ref().map(capture_selection),
            composition_key: self.composition_key,
            source_records: self.source_records.clone(),
            origin: self.origin.clone(),
            detached: self
                .detached
                .iter()
                .map(|slot| slot.as_ref().map(capture_selection))
                .collect(),
        }
    }
}

impl ForeignReadSnapshot {
    /// Captured node map and active selection, including pending writes.
    pub fn state(&self) -> &EditorState {
        &self.state
    }

    /// Whether this capture originated in the given editor and exact update.
    /// This proves provenance, not freshness or continued callback authorization;
    /// the host must also check that the matching update is still active.
    /// Plain editor-state captures have no origin and always return false.
    pub fn matches_origin(
        &self,
        editor: &ForeignEditorIdentity,
        update: &ForeignUpdateIdentity,
    ) -> bool {
        self.origin.as_ref().is_some_and(|origin| {
            Arc::ptr_eq(&origin.editor, &editor.0) && Arc::ptr_eq(&origin.update, &update.0)
        })
    }

    /// Pin the source identity independently of the materialized read payload.
    /// The token must be released with its owning host handle or version.
    pub fn record_identity(&self, key: NodeKey) -> Result<ForeignRecordIdentity, Error> {
        let slot = self
            .source_records
            .get(&key)
            .or_else(|| self.state.nodes.get(&key))
            .ok_or(Error::NodeNotFound(key))?;
        Ok(ForeignRecordIdentity(slot.clone()))
    }

    /// Run model reads through an independently owned, guarded transaction.
    ///
    /// The original committed state supplies editor-state reads; pending reads,
    /// previous selection and composition come from this capture. The peer has
    /// its own key allocator, runtime, extensions and listeners. This is a model
    /// primitive: flush and publication reject before model callbacks. The host
    /// must also guard command/tag/event ABI entry points and implement JS object
    /// freezing and selection value synchronization.
    pub fn with_read_transaction<T>(
        &self,
        committed: &EditorState,
        read: impl FnOnce(&mut Transaction<'_>) -> T,
    ) -> Result<T, Error> {
        if !Arc::ptr_eq(&self.state.registry, &committed.registry) {
            return Err(Error::ForeignEditorState);
        }
        let mut peer = Editor::new(
            self.state.registry.clone(),
            EditorMode::Headless,
            KeySource::PerEditor,
            ViewHost::HEADLESS,
        )?;
        peer.state = committed.clone();
        let mut tx = peer.transaction();
        tx.pending = self.state.pending();
        tx.pending.selection = self.state.selection.as_ref().map(capture_selection);
        tx.composition_key = self.composition_key;
        tx.foreign_read_only = true;
        tx.foreign_read_sources = Some(self.source_records.clone());
        tx.foreign_read_origin = self.origin.clone();
        tx.foreign_previous_selection = self.previous_selection.as_ref().map(capture_selection);
        tx.detached = self
            .detached
            .iter()
            .map(|slot| slot.as_ref().map(capture_selection))
            .collect();
        Ok(read(&mut tx))
    }
}

impl Read for ForeignReadSnapshot {
    fn view(&self) -> StateRef<'_> {
        StateRef {
            state: &self.state,
            native_projection: None,
            source_records: Some(&self.source_records),
            foreign_origin: self.origin.as_ref().map(ReadOrigin::borrowed),
            detached_selections: &self.detached,
            previous_selection: self.previous_selection.as_ref(),
            composition_key: self.composition_key,
        }
    }
}

impl StateRef<'_> {
    /// Capture an owned view for a pure development host callback.
    ///
    /// Materialize an active inherited-native payload projection into the
    /// captured record without invoking a clone hook or changing the source.
    pub fn snapshot_for_foreign_read(self) -> Result<ForeignReadSnapshot, Error> {
        let mut state = self.state.pending();
        state.selection = self.state.selection.as_ref().map(capture_selection);
        let mut source_records = self.source_records.cloned().unwrap_or_default();
        if let Some(projection) = self.native_projection {
            let slot = state
                .nodes
                .get(&projection.key)
                .ok_or(Error::NodeNotFound(projection.key))?;
            let payload = slot
                .data
                .as_any()
                .downcast_ref::<super::projection::ForeignPayload>()
                .ok_or(Error::NodeTypeMismatch(projection.key))?;
            let payload = projection.snapshot_payload(payload)?;
            source_records
                .entry(projection.key)
                .or_insert_with(|| slot.clone());
            let mut record = slot.as_ref().clone();
            record.data = Arc::new(payload);
            state.nodes.insert(projection.key, Arc::new(record));
        }
        Ok(ForeignReadSnapshot {
            state,
            previous_selection: self.previous_selection.map(capture_selection),
            composition_key: self.composition_key,
            source_records,
            origin: self.foreign_origin.map(ReadOriginRef::capture),
            detached: self
                .detached_selections
                .iter()
                .map(|slot| slot.as_ref().map(capture_selection))
                .collect(),
        })
    }
}

#[cfg(test)]
mod test;
