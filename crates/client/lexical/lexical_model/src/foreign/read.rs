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

/// Stable source identity for a development host's captured node object.
/// Materialized native projections retain their source identity. The token
/// retains no record or payload and does not make a live record need cloning.
#[derive(Clone)]
pub struct ForeignRecordIdentity(Arc<()>);

/// A cloned record receives a new identity; cloning an identity retains it.
pub(crate) struct RecordIdentityMarker(pub ForeignRecordIdentity);
impl Default for RecordIdentityMarker {
    fn default() -> Self {
        Self(ForeignRecordIdentity(Arc::new(())))
    }
}
impl Clone for RecordIdentityMarker {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl ForeignRecordIdentity {
    /// Whether a borrowed record is the original captured source record.
    pub fn matches(&self, node: NodeRef<'_>) -> bool {
        Arc::ptr_eq(&self.0, &node.foreign_record_identity().0)
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
    native_calls: Option<Arc<super::native::NativeCalls>>,
    previous_selection: Option<Selection>,
    composition_key: Option<NodeKey>,
    source_records: crate::state::NodeMap,
    detached: Vec<Option<Selection>>,
    origin: Option<ReadOrigin>,
    retired_records: crate::state::NodeMap,
}

impl Selection {
    /// Capture the existing object's fields without invoking upstream `clone()` semantics.
    /// Unlike an explicit selection clone, host suspension and owned read inputs retain
    /// the range direction memo, including an intentionally stale read-mode memo.
    pub fn snapshot_for_foreign_read(&self) -> Self {
        let mut captured = self.clone();
        if let (Self::Range(source), Self::Range(target)) = (self, &mut captured) {
            target.cached_direction = source.cached_direction;
        }
        captured
    }
}

impl Clone for ForeignReadSnapshot {
    fn clone(&self) -> Self {
        let mut state = self.state.clone();
        state.selection = self
            .state
            .selection
            .as_ref()
            .map(Selection::snapshot_for_foreign_read);
        Self {
            state,
            native_calls: self.native_calls.clone(),
            previous_selection: self
                .previous_selection
                .as_ref()
                .map(Selection::snapshot_for_foreign_read),
            composition_key: self.composition_key,
            source_records: self.source_records.clone(),
            origin: self.origin.clone(),
            retired_records: self.retired_records.clone(),
            detached: self
                .detached
                .iter()
                .map(|slot| slot.as_ref().map(Selection::snapshot_for_foreign_read))
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
        self.view().foreign_record_identity(key)
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
        tx.pending.selection = self
            .state
            .selection
            .as_ref()
            .map(Selection::snapshot_for_foreign_read);
        tx.composition_key = self.composition_key;
        tx.foreign_read_only = true;
        if let Some(calls) = &self.native_calls {
            tx.foreign_native_calls = calls.clone();
        }
        tx.foreign_read_sources = Some(self.source_records.clone());
        tx.foreign_read_origin = self.origin.clone();
        tx.foreign_retired_records = self.retired_records.clone();
        tx.foreign_previous_selection = self
            .previous_selection
            .as_ref()
            .map(Selection::snapshot_for_foreign_read);
        tx.detached = self
            .detached
            .iter()
            .map(|slot| slot.as_ref().map(Selection::snapshot_for_foreign_read))
            .collect();
        Ok(read(&mut tx))
    }
}

impl Read for ForeignReadSnapshot {
    fn view(&self) -> StateRef<'_> {
        StateRef {
            state: &self.state,
            native_projection: None,
            foreign_native_calls: self.native_calls.as_ref(),
            source_records: Some(&self.source_records),
            retired_records: Some(&self.retired_records),
            foreign_origin: self.origin.as_ref().map(ReadOrigin::borrowed),
            detached_selections: &self.detached,
            previous_selection: self.previous_selection.as_ref(),
            composition_key: self.composition_key,
        }
    }
}

impl StateRef<'_> {
    /// Source identity for host handles without pinning the node or payload.
    /// A materialized read uses its original source marker rather than its copy.
    pub fn foreign_record_identity(self, key: NodeKey) -> Result<ForeignRecordIdentity, Error> {
        let slot = self
            .source_records
            .and_then(|records| records.get(&key))
            .or_else(|| self.state.nodes.get(&key))
            .ok_or(Error::NodeNotFound(key))?;
        Ok(slot.foreign_identity.0.clone())
    }

    /// Capture an owned view for a pure development host callback.
    ///
    /// Materialize an active inherited-native payload projection into the
    /// captured record without invoking a clone hook or changing the source.
    pub fn snapshot_for_foreign_read(self) -> Result<ForeignReadSnapshot, Error> {
        let mut state = self.state.pending();
        state.selection = self
            .state
            .selection
            .as_ref()
            .map(Selection::snapshot_for_foreign_read);
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
            native_calls: self.foreign_native_calls.cloned(),
            previous_selection: self
                .previous_selection
                .map(Selection::snapshot_for_foreign_read),
            composition_key: self.composition_key,
            source_records,
            origin: self.foreign_origin.map(ReadOriginRef::capture),
            retired_records: self.retired_records.cloned().unwrap_or_default(),
            detached: self
                .detached_selections
                .iter()
                .map(|slot| slot.as_ref().map(Selection::snapshot_for_foreign_read))
                .collect(),
        })
    }
}

#[cfg(test)]
mod test;
