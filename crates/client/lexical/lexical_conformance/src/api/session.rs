//! Owned transaction boundary used by the development WASM host.
use super::Context;
use crate::replay::{Result, fail};
use lexical_model::{
    Commit, Editor, EditorState, PendingUpdate, TagSet, Transaction, UpdateOptions,
};
use serde_json::Value;

/// One model editor and its unpublished update across development host calls.
/// Scheduling and JS callback scopes belong to the platform host.
pub struct Session {
    editor: Editor,
    pending: Option<PendingUpdate>,
    context: Context,
    dirty_types: Vec<String>,
}

impl Session {
    /// Register an application command callback without publishing pending writes.
    pub fn register_listener(
        &mut self,
        registration: lexical_model::CommandRegistration,
        callback: std::sync::Arc<dyn lexical_model::ForeignListener>,
    ) -> lexical_model::ForeignListenerId {
        self.editor
            .register_foreign_listener(registration, callback)
    }
    /// Remove one application command callback.
    pub fn unregister_listener(&mut self, id: lexical_model::ForeignListenerId) {
        self.editor.unregister_foreign_listener(id);
    }
    /// Dispatch through the normal model priority pipeline in the pending update.
    pub fn dispatch_command(
        &mut self,
        command: &lexical_model::Command,
    ) -> Result<lexical_model::Handled> {
        self.with_update(|_, tx| Ok(tx.dispatch(command)?))
    }
    /// Add a development transform between model operations, including while suspended.
    pub fn register_transform(
        &mut self,
        type_name: &str,
        callback: std::sync::Arc<dyn lexical_model::ForeignTransform>,
    ) -> Result<lexical_model::ForeignListenerId> {
        if self.pending.is_some() {
            self.with_update(|_, tx| Ok(tx.mark_foreign_type_dirty(type_name)?))?;
        }
        let id = self
            .editor
            .register_foreign_transform(type_name, callback)?;
        if self.pending.is_none() && !self.dirty_types.iter().any(|name| name == type_name) {
            self.dirty_types.push(type_name.to_owned());
        }
        Ok(id)
    }

    /// Remove a previously registered development transform.
    pub fn unregister_transform(&mut self, id: lexical_model::ForeignListenerId) {
        self.editor.unregister_foreign_transform(id);
    }

    /// Take ownership of an editor configured by the development host.
    pub fn new(editor: Editor) -> Self {
        Self {
            editor,
            pending: None,
            context: Context::default(),
            dirty_types: Vec::new(),
        }
    }

    /// Attach a context whose weak callbacks were used to configure the editor.
    /// The context must be idle and either unbound or already bound to this editor.
    pub fn with_context(mut editor: Editor, context: Context) -> Result<Self> {
        {
            let tx = editor.transaction();
            context.bind_editor(&tx)?;
        }
        Ok(Self {
            editor,
            pending: None,
            context,
            dirty_types: Vec::new(),
        })
    }

    /// Version owning the most recently published host records.
    pub fn committed_version(&self) -> u64 {
        self.context.committed_version()
    }

    /// Last published model state, excluding suspended writes.
    pub fn state(&self) -> &EditorState {
        self.editor.state()
    }

    /// Open an update; model writes remain unpublished until `commit`.
    pub fn begin_update(&mut self, tags: TagSet) -> Result<()> {
        if self.pending.is_some() {
            return Err(fail("an API update is already active"));
        }
        let mut tx = self.editor.transaction_with(UpdateOptions {
            tags,
            ..UpdateOptions::default()
        });
        self.context.begin_update(&mut tx)?;
        for type_name in &self.dirty_types {
            if let Err(error) = tx.mark_foreign_type_dirty(type_name) {
                drop(tx);
                self.context.discard_update()?;
                return Err(error.into());
            }
        }
        self.dirty_types.clear();
        self.pending = Some(tx.suspend());
        Ok(())
    }

    /// Resume, invoke the shared dispatcher, then suspend even on a caught error.
    pub fn call(&mut self, id: u32, args: Value, receiver: Option<Value>) -> Result<Value> {
        self.with_update(|context, tx| context.call(tx, id, args, receiver))
    }

    /// Resume one explicit native-super node operation, then suspend again.
    pub fn call_native(&mut self, id: u32, args: Value, receiver: Value) -> Result<Value> {
        self.with_update(|context, tx| context.call_native(tx, id, args, receiver))
    }

    /// Normalize and run model transforms without publishing the update.
    pub fn flush(&mut self) -> Result<()> {
        self.with_update(|_, tx| Ok(tx.flush()?))
    }

    /// Close a truly unchanged update without publishing a model commit.
    /// Unlike rollback, this retains newly created detached API value objects.
    pub fn finish_noop(&mut self) -> Result<bool> {
        let finished = self.with_update(|context, tx| {
            if tx.has_foreign_effects() {
                return Ok(false);
            }
            context.finish_update(tx)?;
            context.publish(tx.committed_state().clone())?;
            Ok(true)
        })?;
        if finished {
            drop(self.pending.take());
        }
        Ok(finished)
    }

    /// Flush and publish the update atomically, or discard it on failure.
    pub fn commit(&mut self) -> Result<Commit> {
        self.commit_prepared(|_, _| Ok(()))
            .map(|(commit, ())| commit)
    }

    /// Encode a host artifact before model publication, discarding this update
    /// if preparation fails. Earlier published transitions are not rolled back.
    pub fn commit_prepared<T>(
        &mut self,
        prepare: impl FnOnce(&Commit, u64) -> Result<T>,
    ) -> Result<(Commit, T)> {
        let pending = self
            .pending
            .take()
            .ok_or_else(|| fail("no API update is active"))?;
        let mut tx = match self.editor.resume(pending) {
            Ok(tx) => tx,
            Err(error) => {
                self.context.discard_update()?;
                return Err(error.into());
            }
        };
        if tx.needs_flush()
            && let Err(error) = tx.flush()
        {
            drop(tx);
            self.context.discard_update()?;
            return Err(error.into());
        }
        if let Err(error) = self.context.finish_update(&tx) {
            drop(tx);
            self.context.discard_update()?;
            return Err(error);
        }
        let version = self.context.publishing_version()?;
        let (commit, artifact) = match tx.commit_foreign(|commit| prepare(commit, version)) {
            Ok(prepared) => prepared,
            Err(error) => {
                self.context.discard_update()?;
                return Err(error);
            }
        };
        let last = commit.chain().last().expect("commit chain includes itself");
        self.context.publish(last.next.clone())?;
        Ok((commit, artifact))
    }

    /// Drop unpublished model writes and invalidate their handles.
    pub fn discard_update(&mut self) -> Result<()> {
        let pending = self
            .pending
            .take()
            .ok_or_else(|| fail("no API update is active"))?;
        drop(pending);
        self.context.discard_update()
    }

    /// Read a captured node field during an update or from a published snapshot.
    pub fn read_field(&mut self, handle: u32, field: &str) -> Result<Value> {
        if self.pending.is_some() {
            self.with_update(|context, tx| context.read_field(tx, handle, field))
        } else {
            let mut tx = self.editor.transaction();
            self.context.read_field(&mut tx, handle, field)
        }
    }

    /// Release handles and snapshot pins when the host collects a state.
    /// The host defers this while that version is borrowed by an open update.
    pub fn release_version(&mut self, version: u64) -> Result<()> {
        self.context.release_version(version)
    }

    fn with_update<ValueType>(
        &mut self,
        body: impl FnOnce(&mut Context, &mut Transaction<'_>) -> Result<ValueType>,
    ) -> Result<ValueType> {
        let pending = self
            .pending
            .take()
            .ok_or_else(|| fail("no API update is active"))?;
        let mut tx = match self.editor.resume(pending) {
            Ok(tx) => tx,
            Err(error) => {
                self.context.discard_update()?;
                return Err(error.into());
            }
        };
        let value = body(&mut self.context, &mut tx);
        self.pending = Some(tx.suspend());
        value
    }
}

#[cfg(test)]
mod test;
