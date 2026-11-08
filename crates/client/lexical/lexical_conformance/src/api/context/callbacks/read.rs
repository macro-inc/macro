//! Indexed reads over one owned peer, never the invoking transaction.
use super::*;

/// A scoped dispatcher over an independently owned, guarded read transaction.
///
/// It cannot publish, register callbacks, dispatch commands or return its model
/// transaction. New detached selection values survive for later mutable calls.
/// A read scope cannot hydrate saved values absent from its capture. Mutating a
/// selection inherited from the invoking frame is not supported yet and rejects
/// explicitly; synchronizing those ordinary JS object writes requires a separate
/// host protocol before this primitive can host every pure foreign hook.
pub struct CallbackRead<'scope, 'editor> {
    pub(super) context: Context,
    pub(super) tx: &'scope mut Transaction<'editor>,
    snapshot: &'scope ForeignReadSnapshot,
    first_created: usize,
}

impl CallbackContext {
    /// Keep one owned read peer alive for all reentrant calls in a pure callback.
    /// The capture must belong to the currently active exact update, including
    /// its publication phase. Originless captures additionally require the exact
    /// canonical state and active lease supplied by commit preparation.
    pub fn with_read_scope<T>(
        &self,
        snapshot: &ForeignReadSnapshot,
        read: impl FnOnce(&mut CallbackRead<'_, '_>) -> Result<T>,
    ) -> Result<T> {
        let frames = self
            .0
            .upgrade()
            .ok_or(crate::replay::ReplayError::NoActiveEditor)?;
        let snapshot = frames.read_capture(snapshot)?;
        let active = frames.captured(&snapshot)?;
        let mut context = frames.context(&active)?;
        context.replay.selections = context.replay.selections.fork_read();
        let first_created = context.replay.selections.len()?;
        let committed = context
            .replay
            .record_owner
            .as_ref()
            .ok_or_else(|| fail("callback committed state was released"))?
            .1
            .clone();
        snapshot.with_read_transaction(&committed, |tx| {
            context.replay.selections.synchronize(tx)?;
            let mut scope = CallbackRead {
                context,
                tx,
                snapshot: &snapshot,
                first_created,
            };
            let result = read(&mut scope);
            // Ordinary owned value writes survive a caught callback exception.
            // Never publish the captured ancestor values over fresher originals.
            let captured = scope.capture_values();
            match result {
                Err(error) => Err(error),
                Ok(value) => captured.map(|()| value),
            }
        })?
    }
}

impl CallbackRead<'_, '_> {
    pub(super) fn validate(&self) -> Result<()> {
        self.context.frames.captured(self.snapshot).map(|_| ())
    }

    fn check_call(&mut self, id: u32, receiver: Option<&Value>) -> Result<()> {
        self.validate()?;
        let name = super::super::super::index()
            .get(id as usize)
            .ok_or_else(|| fail(format!("unknown API id {id}")))?;
        if matches!(
            *name,
            "LexicalEditor.dispatchCommand"
                | "lexical.$addUpdateTag"
                | "lexical/LexicalUtils.scheduleMicroTask"
        ) {
            return Err(fail("editor effects are forbidden in a foreign read scope"));
        }
        let method = name.rsplit('.').next().unwrap_or(name);
        if matches!(method, "set" | "setTextNodeRange" | "add")
            && let Some(receiver) = receiver
        {
            let receiver = self.context.replay.decode(receiver)?;
            let selection = receiver.get("$selection").or_else(|| {
                receiver
                    .get("$point")
                    .and_then(|point| point.get("selection"))
            });
            if let Some(selection) = selection {
                let identity = self
                    .context
                    .replay
                    .selections
                    .identity(integer(selection)? as usize)?
                    .ok_or_else(|| fail("selection identity"))?;
                if self.snapshot.contains_selection_identity(&identity) {
                    return Err(fail(
                        "inherited selection value writes need ancestor synchronization",
                    ));
                }
            }
        }
        Ok(())
    }

    /// Encode a node from this read capture in the shared handle store.
    pub fn node(&mut self, key: NodeKey) -> Result<Value> {
        self.validate()?;
        let value = self.context.replay.node(self.tx.view(), key)?;
        self.context.encode(value)
    }

    /// Encode a captured ordinary selection argument through the shared identity store.
    pub fn selection_argument(
        &mut self,
        argument: &lexical_model::ForeignSelectionCapture,
    ) -> Result<Value> {
        self.validate()?;
        let identity = argument.identity().cloned().unwrap_or_default();
        if argument.identity().is_some() && !self.snapshot.contains_selection_identity(&identity) {
            return Err(fail("selection argument is absent from this read capture"));
        }
        let slot = match self.tx.foreign_selection_slot(&identity) {
            Some(slot) => slot,
            None => self
                .tx
                .detach_foreign_selection(argument.value().snapshot_for_foreign_read(), identity),
        };
        let value = self.context.replay.selection_at(self.tx, slot)?;
        self.context.encode(value)
    }

    /// Consume the invoking indexed method's arguments without borrowing its transaction.
    pub fn original_arguments(
        &self,
        key: NodeKey,
        hook: lexical_model::ForeignHook,
    ) -> Result<Option<Vec<Value>>> {
        self.validate()?;
        Ok(self.context.frames.arguments.take(key, hook))
    }

    /// Dispatch an indexed read or an operation on a newly owned value.
    /// Model write guards reject node mutations before calling foreign hooks.
    pub fn call(&mut self, id: u32, args: Value, receiver: Option<Value>) -> Result<Value> {
        self.check_call(id, receiver.as_ref())?;
        self.context.dispatch(self.tx, id, args, receiver)
    }

    /// Invoke the nearest native node hook over the same owned read peer.
    pub fn call_native(&mut self, id: u32, args: Value, receiver: Value) -> Result<Value> {
        self.check_call(id, Some(&receiver))?;
        self.context.dispatch_native(self.tx, id, args, receiver)
    }

    /// Read a captured node's raw field without invoking a virtual accessor.
    pub fn read_field(&mut self, handle: u32, field: &str) -> Result<Value> {
        self.validate()?;
        self.context.read_captured_field(self.tx, handle, field)
    }

    fn capture_values(&mut self) -> Result<()> {
        self.validate()?;
        self.context.replay.selections.synchronize(self.tx)?;
        for (id, slot) in self
            .context
            .replay
            .selections
            .slots()?
            .into_iter()
            .enumerate()
        {
            if id < self.first_created {
                continue;
            }
            let Some(slot) = slot else { continue };
            let identity = self
                .context
                .replay
                .selections
                .identity(id)?
                .ok_or_else(|| fail("selection identity"))?;
            if !self.snapshot.contains_selection_identity(&identity) {
                // Read frames never hydrate absent tokens. A locally present,
                // uncaptured token therefore belongs to a value created here.
                // Nested scopes see it as inherited and cannot publish it.
                let value = self
                    .tx
                    .selection_at(slot)?
                    .map(Selection::snapshot_for_foreign_read);
                if self.context.replay.version <= self.context.replay.committed_version {
                    self.context
                        .replay
                        .selections
                        .save_independent_value(id, value)?;
                } else {
                    self.context.replay.selections.save_value(id, value)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
