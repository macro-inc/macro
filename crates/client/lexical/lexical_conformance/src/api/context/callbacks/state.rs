//! Associated-editor reads of retained immutable states, with nested authority.
use super::*;
use lexical_model::{ForeignReadContext, ForeignReadLease};

pub(crate) struct PreparedStateRead {
    source: ForeignReadContext,
    active: ActiveUpdate,
}

struct StateRead<'scope> {
    frames: &'scope Frames,
    active: Option<ActiveUpdate>,
    publication: Option<Arc<publication::PreparedRead>>,
}
impl Drop for StateRead<'_> {
    fn drop(&mut self) {
        let removed = {
            let mut slot = self.frames.publication.lock().expect("prepared read store");
            std::mem::replace(&mut *slot, self.publication.take())
        };
        *self.frames.current.lock().expect("callback frame store") = self.active.take();
        drop(removed);
    }
}

impl Context {
    pub(crate) fn read_state<T>(
        &mut self,
        tx: Transaction<'_>,
        version: u64,
        read: impl FnOnce(&mut CallbackRead<'_, '_>) -> Result<T>,
    ) -> Result<T> {
        let prepared = self.prepare_state_read(&tx, version)?;
        drop(tx);
        self.read_prepared_state(prepared, version, read)
    }

    pub(crate) fn prepare_state_read(
        &mut self,
        tx: &Transaction<'_>,
        version: u64,
    ) -> Result<PreparedStateRead> {
        self.frames.bind_owner(tx)?;
        let committed_version = self.replay.committed_version;
        if self.replay.bindings.state(&committed_version)?.is_none() {
            self.replay
                .bindings
                .pin_state(committed_version, tx.committed_state().clone())?;
        }
        let active = ActiveUpdate {
            owner: tx.foreign_editor_identity(),
            update: tx.foreign_update_identity(),
            mutable: false,
            version,
            committed_version,
        };
        Ok(PreparedStateRead {
            source: tx.view().context_for_foreign_read()?,
            active,
        })
    }

    pub(crate) fn read_prepared_state<T>(
        &mut self,
        prepared: PreparedStateRead,
        version: u64,
        read: impl FnOnce(&mut CallbackRead<'_, '_>) -> Result<T>,
    ) -> Result<T> {
        self.frames
            .with_state_read(prepared.source, prepared.active, version, read)
    }
}

impl Frames {
    fn with_state_read<T>(
        self: &Arc<Self>,
        source: ForeignReadContext,
        mut active: ActiveUpdate,
        version: u64,
        read: impl FnOnce(&mut CallbackRead<'_, '_>) -> Result<T>,
    ) -> Result<T> {
        let state = self
            .bindings
            .state(&version)?
            .ok_or_else(|| fail("editor state version was released or never published"))?;
        active.mutable = false;
        active.version = version;
        // The read graph is historical; editor-dependent APIs still see the
        // associated editor's latest committed state and selection owner.
        let prepared = Arc::new(publication::PreparedRead {
            state: state.clone(),
            source,
            lease: ForeignReadLease::default(),
        });
        let capture = state.view().snapshot_for_foreign_read()?;
        let previous_publication = {
            let mut slot = self
                .publication
                .lock()
                .map_err(|_| fail("prepared read store poisoned"))?;
            slot.replace(prepared)
        };
        let previous_active = self
            .current
            .lock()
            .expect("callback frame store")
            .replace(active);
        let _scope = StateRead {
            frames: self,
            active: previous_active,
            publication: previous_publication,
        };
        CallbackContext::new(self).with_read_scope(&capture, read)
    }
}

impl CallbackContext {
    /// Read a retained version using the current mutable callback's associated editor.
    pub fn with_state_read<T>(
        &self,
        tx: &Transaction<'_>,
        version: u64,
        read: impl FnOnce(&mut CallbackRead<'_, '_>) -> Result<T>,
    ) -> Result<T> {
        let frames = self
            .0
            .upgrade()
            .ok_or(crate::replay::ReplayError::NoActiveEditor)?;
        let active = frames.active(tx)?;
        let source = tx.view().context_for_foreign_read()?;
        frames.with_state_read(source, active, version, read)
    }
}

impl CallbackRead<'_, '_> {
    /// Nest another retained-state read without accessing a leased Session.
    pub fn with_state_read<T>(
        &mut self,
        version: u64,
        read: impl FnOnce(&mut CallbackRead<'_, '_>) -> Result<T>,
    ) -> Result<T> {
        self.validate()?;
        let frames = self.context.frames.clone();
        let active = frames.current()?;
        let source = self.tx.view().context_for_foreign_read()?;
        frames.with_state_read(source, active, version, read)
    }
}
