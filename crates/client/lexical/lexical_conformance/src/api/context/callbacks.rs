//! Weak editor-owned metadata for independent mutable host callback frames.
use super::*;
use crate::replay::{Bindings, CaretBindings, RecordIdentities, SelectionBindings};
use lexical_model::{ForeignEditorIdentity, ForeignUpdateIdentity};
use std::sync::{Arc, Mutex, Weak};

pub(super) struct Frames {
    bindings: Bindings,
    records: RecordIdentities,
    selections: SelectionBindings,
    carets: CaretBindings,
    current: Mutex<Option<ActiveUpdate>>,
    owner: Mutex<Option<ForeignEditorIdentity>>,
}

#[derive(Clone)]
struct ActiveUpdate {
    owner: ForeignEditorIdentity,
    update: ForeignUpdateIdentity,
    mutable: bool,
    version: u64,
    committed_version: u64,
}

/// Weak dispatch capability retained by development host callback owners.
///
/// Each call needs the current mutable model-hook reborrow. This retains no
/// editor, transaction, dispatcher, registry or pinned state, and does not grant
/// pure callbacks permission to borrow their invoking transaction.
#[derive(Clone)]
pub struct CallbackContext(Weak<Frames>);

impl Frames {
    pub fn new(replay: &Replayer) -> Self {
        Self {
            bindings: replay.bindings.clone(),
            records: replay.record_ids.clone(),
            selections: replay.selections.clone(),
            carets: replay.carets.clone(),
            current: Mutex::default(),
            owner: Mutex::default(),
        }
    }

    pub fn bind_owner(&self, tx: &Transaction<'_>) -> Result<()> {
        let identity = tx.foreign_editor_identity();
        let owner = {
            let mut owner = self
                .owner
                .lock()
                .map_err(|_| fail("callback owner store poisoned"))?;
            owner.get_or_insert(identity).clone()
        };
        if !owner.matches(tx) {
            return Err(fail("API context belongs to another editor"));
        }
        Ok(())
    }

    pub fn begin(&self, replay: &Replayer, tx: &Transaction<'_>) -> Result<()> {
        let active = ActiveUpdate {
            owner: tx.foreign_editor_identity(),
            update: tx.foreign_update_identity(),
            mutable: true,
            version: replay.version,
            committed_version: replay.committed_version,
        };
        *self
            .current
            .lock()
            .map_err(|_| fail("callback frame store poisoned"))? = Some(active);
        Ok(())
    }

    pub fn finish(&self) -> Result<()> {
        if let Some(active) = self
            .current
            .lock()
            .map_err(|_| fail("callback frame store poisoned"))?
            .as_mut()
        {
            active.mutable = false;
        }
        Ok(())
    }

    pub fn end(&self) -> Result<()> {
        *self
            .current
            .lock()
            .map_err(|_| fail("callback frame store poisoned"))? = None;
        Ok(())
    }

    pub fn validate(&self, tx: &Transaction<'_>) -> Result<()> {
        self.active(tx).map(|_| ())
    }

    fn active(&self, tx: &Transaction<'_>) -> Result<ActiveUpdate> {
        let active = self
            .current
            .lock()
            .map_err(|_| fail("callback frame store poisoned"))?
            .clone()
            .ok_or(crate::replay::ReplayError::NoActiveEditor)?;
        if !active.mutable {
            return Err(crate::replay::ReplayError::NoActiveEditor);
        }
        if !active.owner.matches(tx) {
            return Err(fail("callback transaction belongs to another editor"));
        }
        if !active.update.matches(tx) {
            return Err(fail("callback transaction belongs to another update"));
        }
        Ok(active)
    }
}

impl CallbackContext {
    pub(super) fn new(frames: &Arc<Frames>) -> Self {
        Self(Arc::downgrade(frames))
    }

    /// Dispatch through an independent frame using the current mutable reborrow.
    /// Calling outside an open update or after editor teardown fails.
    pub fn call(
        &self,
        tx: &mut Transaction<'_>,
        id: u32,
        args: Value,
        receiver: Option<Value>,
    ) -> Result<Value> {
        let frames = self
            .0
            .upgrade()
            .ok_or(crate::replay::ReplayError::NoActiveEditor)?;
        let active = frames.active(tx)?;
        let committed = frames
            .bindings
            .state(&active.committed_version)?
            .ok_or_else(|| fail("callback committed state was released"))?;
        let mut context = Context {
            replay: Replayer {
                bindings: frames.bindings.clone(),
                record_ids: frames.records.clone(),
                selections: frames.selections.clone(),
                carets: frames.carets.clone(),
                version: active.version,
                committed_version: active.committed_version,
                record_owner: Some((active.committed_version, committed)),
                in_callback: true,
                ..Replayer::default()
            },
            frames,
            scope: Scope::Updating,
            previous_selections: Vec::new(),
        };
        context.call(tx, id, args, receiver)
    }
}
