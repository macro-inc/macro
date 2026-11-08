//! Fixture value identities owned by one development host editor.
use crate::replay::{Replayer, Result, fail, integer, node_key, tagged_key};
use lexical_model::{EditorState, NodeKey, Selection, Transaction};
use serde_json::{Value, json};
use std::sync::Arc;
mod arguments;
mod callbacks;
use callbacks::Frames;
pub use callbacks::{CallbackContext, CallbackRead};

/// Shared dispatch and fixture-value encoding across suspended host calls.
///
/// This owns identities and immutable published states, never a parallel editor
/// model. Transactions and their suspend/resume lifecycle belong to the host.
pub struct Context {
    replay: Replayer,
    frames: Arc<Frames>,
    scope: Scope,
    previous_selections: Vec<Option<Selection>>,
}

#[derive(Default, PartialEq, Eq)]
enum Scope {
    #[default]
    Idle,
    Updating,
    Publishing,
}

impl Default for Context {
    fn default() -> Self {
        let replay = Replayer::default();
        let frames = Arc::new(Frames::new(&replay));
        Self {
            replay,
            frames,
            scope: Scope::Idle,
            previous_selections: Vec::new(),
        }
    }
}

impl Context {
    /// Version owning the most recently published host records.
    pub fn committed_version(&self) -> u64 {
        self.replay.committed_version
    }

    pub(super) fn publishing_version(&self) -> Result<u64> {
        if self.scope != Scope::Publishing {
            return Err(fail("finish the API update before preparation"));
        }
        Ok(self.replay.version)
    }

    /// Capture a weak callback capability before registering foreign hooks.
    pub fn callbacks(&self) -> CallbackContext {
        CallbackContext::new(&self.frames)
    }

    pub(super) fn bind_editor(&self, tx: &Transaction<'_>) -> Result<()> {
        if self.scope != Scope::Idle {
            return Err(fail("an API update is already active"));
        }
        self.frames.bind_owner(tx)
    }

    /// Start bookkeeping for a newly opened transaction.
    pub fn begin_update(&mut self, tx: &mut Transaction<'_>) -> Result<()> {
        self.bind_editor(tx)?;
        self.replay.version = self
            .replay
            .version
            .checked_add(1)
            .ok_or_else(|| fail("API version overflow"))?;
        if self
            .replay
            .bindings
            .state(&self.replay.committed_version)?
            .is_none()
        {
            self.replay
                .bindings
                .pin_state(self.replay.committed_version, tx.committed_state().clone())?;
        }
        // Register the committed object before taking the rollback backup. A
        // first capture during this update still belongs to the committed state.
        if let Some(slot) = tx.detach_previous_foreign_selection()? {
            let value = self.replay.selection_at(tx, slot)?;
            self.replay.selections.save_value(
                integer(&value["$selection"])? as usize,
                tx.selection_at(slot)?
                    .map(Selection::snapshot_for_foreign_read),
            )?;
        }
        self.previous_selections = self.replay.selections.values()?;
        self.replay.record_owner =
            Some((self.replay.committed_version, tx.committed_state().clone()));
        self.replay.begin_slots(tx, true)?;
        self.replay
            .bindings
            .bind_key("root".into(), NodeKey::ROOT)?;
        self.replay.in_callback = true;
        self.frames.begin(&self.replay, tx)?;
        self.scope = Scope::Updating;
        Ok(())
    }

    /// Capture selection objects before committing the current transaction.
    pub fn finish_update(&mut self, tx: &Transaction<'_>) -> Result<()> {
        if self.scope != Scope::Updating {
            return Err(fail("no API update is active"));
        }
        self.frames.validate(tx)?;
        self.replay.capture_slots(tx)?;
        self.frames.finish()?;
        self.replay.in_callback = false;
        self.scope = Scope::Publishing;
        Ok(())
    }

    /// Pin the committed snapshot for raw fields of captured node handles.
    pub fn publish(&mut self, state: EditorState) -> Result<u64> {
        if self.scope != Scope::Publishing {
            return Err(fail("finish the API update before publication"));
        }
        self.replay.bindings.pin_state(self.replay.version, state)?;
        self.replay.committed_version = self.replay.version;
        self.replay.record_owner = None;
        self.previous_selections.clear();
        self.frames.end()?;
        self.scope = Scope::Idle;
        Ok(self.replay.version)
    }

    /// Forget an unpublished update after the host drops its transaction.
    pub fn discard_update(&mut self) -> Result<()> {
        if self.scope == Scope::Idle {
            return Err(fail("no API update is active"));
        }
        self.frames.end()?;
        self.scope = Scope::Idle;
        self.replay.in_callback = false;
        self.replay.record_owner = None;
        self.replay
            .selections
            .restore_values(std::mem::take(&mut self.previous_selections))?;
        self.release_version(self.replay.version)
    }

    /// Dispatch an indexed operation using fixture-encoded arguments/receiver.
    pub fn call(
        &mut self,
        tx: &mut Transaction<'_>,
        id: u32,
        args: Value,
        receiver: Option<Value>,
    ) -> Result<Value> {
        if self.scope != Scope::Updating {
            return Err(crate::replay::ReplayError::NoActiveEditor);
        }
        self.frames.validate(tx)?;
        self.dispatch(tx, id, args, receiver)
    }

    fn dispatch(
        &mut self,
        tx: &mut Transaction<'_>,
        id: u32,
        args: Value,
        receiver: Option<Value>,
    ) -> Result<Value> {
        let _arguments = match (
            super::index()
                .get(id as usize)
                .and_then(|name| name.strip_prefix("LexicalNode.")),
            receiver.as_ref(),
            args.as_array(),
        ) {
            (Some(method), Some(receiver), Some(args)) => {
                let hook = lexical_model::ForeignHook::ALL
                    .iter()
                    .copied()
                    .find(|hook| hook.upstream_name() == method);
                match hook {
                    Some(hook) => {
                        let key = node_key(&self.replay.decode(receiver)?)?;
                        Some(self.frames.arguments.enter(key, hook, args.clone()))
                    }
                    None => None,
                }
            }
            _ => None,
        };
        let result = super::call_by_id(&mut self.replay, tx, id, args, receiver)?;
        self.encode(result)
    }

    /// Dispatch to the nearest native ancestor, preserving nested virtual calls.
    /// This does not select an explicitly named older native prototype.
    pub fn call_native(
        &mut self,
        tx: &mut Transaction<'_>,
        id: u32,
        args: Value,
        receiver: Value,
    ) -> Result<Value> {
        if self.scope != Scope::Updating {
            return Err(crate::replay::ReplayError::NoActiveEditor);
        }
        self.frames.validate(tx)?;
        self.dispatch_native(tx, id, args, receiver)
    }

    fn dispatch_native(
        &mut self,
        tx: &mut Transaction<'_>,
        id: u32,
        args: Value,
        receiver: Value,
    ) -> Result<Value> {
        let method = super::index()
            .get(id as usize)
            .and_then(|name| name.strip_prefix("LexicalNode."))
            .ok_or_else(|| fail("native-super requires a node hook API"))?;
        let hook = lexical_model::ForeignHook::ALL
            .iter()
            .copied()
            .find(|hook| hook.upstream_name() == method)
            .ok_or_else(|| fail("native-super requires a node hook API"))?;
        let key = node_key(&self.replay.decode(&receiver)?)?;
        let result = tx.with_foreign_native(key, hook, |tx| {
            super::call_by_id(&mut self.replay, tx, id, args, Some(receiver))
        })?;
        self.encode(result)
    }

    /// Read a raw captured field without changing the active update's version.
    pub fn read_field(
        &mut self,
        tx: &mut Transaction<'_>,
        handle: u32,
        field: &str,
    ) -> Result<Value> {
        if self.scope == Scope::Idle {
            self.frames.bind_owner(tx)?;
        } else {
            self.frames.validate(tx)?;
        }
        self.read_captured_field(tx, handle, field)
    }

    fn read_captured_field(
        &mut self,
        tx: &mut Transaction<'_>,
        handle: u32,
        field: &str,
    ) -> Result<Value> {
        let receiver = self.replay.decode(&json!({"$h":handle}))?;
        let value = super::properties::get(&mut self.replay, tx, &receiver, field)?;
        self.encode(value)
    }

    /// Release a state and its host-owned handles after that state is collected.
    /// A host must retain a state while any of its JS handles remain reachable.
    /// Defer collection while an update borrows that committed or pending version.
    pub fn release_version(&mut self, version: u64) -> Result<()> {
        if self.scope != Scope::Idle && self.replay.version == version {
            return Err(fail("cannot release the active API version"));
        }
        if self
            .replay
            .record_owner
            .as_ref()
            .is_some_and(|(owner, _)| *owner == version)
        {
            return Err(fail(
                "cannot release the committed version borrowed by an API update",
            ));
        }
        self.replay.bindings.release_state(version)?;
        self.replay.record_ids.release_version(version)?;
        let released = self.replay.bindings.release_identities(version)?;
        for tag in ["$h", "$sel", "$pt", "$caret", "$iterator", "$state", "$ed"] {
            for id in &released {
                if let Some(value) = self.replay.bindings.remove_handle(&format!("{tag}:{id}"))?
                    && let Some(snapshot) = value.get("$snapshot")
                {
                    let snapshot = integer(snapshot)? as usize;
                    self.replay.bindings.release_saved_state(snapshot)?;
                }
            }
        }
        Ok(())
    }

    fn encode(&mut self, value: Value) -> Result<Value> {
        if value.get("$nodeKey").is_some() {
            let key = tagged_key(&value, "$nodeKey")?;
            let raw = key.to_string();
            self.replay.bindings.bind_key(raw.clone(), key)?;
            // Key references use a known node handle when available. The raw
            // string remains authoritative for fixture decoding.
            return Ok(
                match self.replay.bindings.identity(&format!("key:{raw}"))? {
                    Some(id) => json!({"$key":id,"raw":raw}),
                    None => json!(raw),
                },
            );
        }
        for (raw_tag, tag) in [
            ("$node", "$h"),
            ("$selection", "$sel"),
            ("$point", "$pt"),
            ("$caretValue", "$caret"),
            ("$iteratorValue", "$iterator"),
            ("$snapshot", "$state"),
            ("$editor", "$ed"),
        ] {
            if value.get(raw_tag).is_none() {
                continue;
            }
            let identity = if raw_tag == "$node" {
                let key = node_key(&value)?;
                format!(
                    "node:{}:{}:{}",
                    key.generation(),
                    key,
                    integer(&value["ver"])?
                )
            } else {
                format!("{tag}:{}", serde_json::to_string(&value)?)
            };
            let owner = match raw_tag {
                "$node" => integer(&value["ver"])?,
                "$snapshot" => self.replay.committed_version,
                "$selection" | "$point" => {
                    let id = if raw_tag == "$selection" {
                        integer(&value[raw_tag])?
                    } else {
                        integer(&value[raw_tag]["selection"])?
                    } as usize;
                    let token = self.replay.selections.identity(id)?;
                    let committed = self.replay.bindings.state(&self.replay.committed_version)?;
                    let is_committed = match (token, committed) {
                        (Some(token), Some(state)) => state
                            .view()
                            .snapshot_for_foreign_read()?
                            .contains_selection_identity(&token),
                        _ => false,
                    };
                    if is_committed {
                        self.replay.committed_version
                    } else {
                        self.replay.version
                    }
                }
                _ => self.replay.version,
            };
            let (id, fresh) = self
                .replay
                .bindings
                .intern_handle(identity, owner, tag, &value)?;
            if !fresh {
                return Ok(json!({tag:id}));
            }
            let mut encoded = json!({tag:id});
            if raw_tag == "$node" {
                let key = node_key(&value)?;
                self.replay.bindings.bind_host_key(key, id)?;
                encoded["key"] = json!(key.to_string());
                encoded["type"] = value["type"].clone();
                encoded["ver"] = value["ver"].clone();
            } else if raw_tag == "$selection" {
                encoded["kind"] = value["kind"].clone();
            } else if raw_tag == "$caretValue" {
                for field in ["origin", "direction", "type"] {
                    if let Some(field_value) = value.get(field) {
                        encoded[field] = self.encode(field_value.clone())?;
                    }
                }
            }
            return Ok(encoded);
        }
        match value {
            Value::Array(values) => values.into_iter().map(|v| self.encode(v)).collect(),
            Value::Object(values) => values
                .into_iter()
                .map(|(k, v)| Ok((k, self.encode(v)?)))
                .collect::<Result<serde_json::Map<_, _>>>()
                .map(Value::Object),
            value => Ok(value),
        }
    }
}

#[cfg(test)]
mod test;
