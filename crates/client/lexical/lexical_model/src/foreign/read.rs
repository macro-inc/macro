//! Independent inputs for development host read callouts.
use crate::*;
use std::sync::Arc;

/// An owned pending or committed read view, independent of its source borrow.
///
/// Pure host callbacks use this capture instead of reading a transaction that
/// is already borrowed by the operation invoking them. A host still needs a
/// separate guarded read dispatcher; this value grants no mutation capability.
#[derive(Clone)]
pub struct ForeignReadSnapshot {
    state: EditorState,
    previous_selection: Option<Selection>,
    composition_key: Option<NodeKey>,
}

impl ForeignReadSnapshot {
    /// Captured node map and active selection, including pending writes.
    pub fn state(&self) -> &EditorState {
        &self.state
    }
}

impl Read for ForeignReadSnapshot {
    fn view(&self) -> StateRef<'_> {
        StateRef {
            state: &self.state,
            native_projection: None,
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
            let mut record = slot.as_ref().clone();
            record.data = Arc::new(payload);
            state.nodes.insert(projection.key, Arc::new(record));
        }
        Ok(ForeignReadSnapshot {
            state,
            previous_selection: self.previous_selection.cloned(),
            composition_key: self.composition_key,
        })
    }
}

#[cfg(test)]
mod test;
