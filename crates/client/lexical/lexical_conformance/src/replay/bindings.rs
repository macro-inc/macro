//! Owned bindings shared by dispatchers without borrowing an ancestor frame.
use super::{Result, fail, integer, node_key};
use lexical_model::{EditorState, NodeKey, NodeRecord, Transaction};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Clone, Default)]
pub(crate) struct Bindings(Arc<Mutex<Values>>);

#[derive(Default)]
struct Values {
    handles: HashMap<String, Value>,
    keys: HashMap<String, NodeKey>,
    states: HashMap<(u64, u64), EditorState>,
    retired: HashMap<(u64, u64), HashMap<NodeKey, Arc<NodeRecord>>>,
    saved_states: Vec<Option<EditorState>>,
    saved_versions: HashMap<usize, (u64, u64)>,
    published_snapshots: HashMap<(u64, u64), usize>,
    identities: HashMap<String, u32>,
    owners: HashMap<u32, (u64, u64)>,
    next_handle: u32,
}

impl Bindings {
    // Every public operation handles owned data only. Never return a guard or
    // invoke model/host code under one, including during recursive decoding.
    fn lock(&self) -> Result<MutexGuard<'_, Values>> {
        self.0
            .lock()
            .map_err(|_| fail("API binding store poisoned"))
    }

    pub fn identity(&self, identity: &str) -> Result<Option<u32>> {
        Ok(self.lock()?.identities.get(identity).copied())
    }

    /// Allocate and bind atomically. JSON values contain no callback owners.
    pub fn intern_handle(
        &self,
        identity: String,
        owner: u64,
        tag: &str,
        value: &Value,
    ) -> Result<(u32, bool)> {
        let mut values = self.lock()?;
        if let Some(id) = values.identities.get(&identity) {
            return Ok((*id, false));
        }
        let id = values.next_handle;
        values.next_handle = id
            .checked_add(1)
            .ok_or_else(|| fail("API handle overflow"))?;
        values.identities.insert(identity, id);
        values.owners.insert(
            id,
            (
                value.get("editor").and_then(Value::as_u64).unwrap_or(0),
                owner,
            ),
        );
        values.handles.insert(format!("{tag}:{id}"), value.clone());
        Ok((id, true))
    }

    pub fn bind_host_key(&self, key: NodeKey, id: u32) -> Result<()> {
        let mut values = self.lock()?;
        values.keys.insert(key.to_string(), key);
        values.identities.insert(format!("key:{key}"), id);
        Ok(())
    }

    pub fn release_editor_identities(
        &self,
        editor: u64,
        version: u64,
    ) -> Result<std::collections::HashSet<u32>> {
        let mut values = self.lock()?;
        let released = values
            .owners
            .iter()
            .filter_map(|(id, owner)| (*owner == (editor, version)).then_some(*id))
            .collect::<std::collections::HashSet<_>>();
        values.owners.retain(|_, owner| *owner != (editor, version));
        values.identities.retain(|_, id| !released.contains(id));
        Ok(released)
    }

    /// All frames share the identity of the currently published editor state.
    pub fn published_editor_state(
        &self,
        editor: u64,
        version: u64,
        state: &EditorState,
    ) -> Result<usize> {
        let mut values = self.lock()?;
        if let Some(id) = values.published_snapshots.get(&(editor, version)) {
            return Ok(*id);
        }
        let id = values.saved_states.len();
        values.saved_states.push(Some(state.clone()));
        values.published_snapshots.insert((editor, version), id);
        values.saved_versions.insert(id, (editor, version));
        Ok(id)
    }

    pub fn snapshots(&self) -> Result<Vec<EditorState>> {
        let values = self.lock()?;
        Ok(values
            .states
            .values()
            .chain(values.saved_states.iter().flatten())
            .cloned()
            .collect())
    }

    pub fn handle(&self, binding: &str) -> Result<Option<Value>> {
        Ok(self.lock()?.handles.get(binding).cloned())
    }

    pub fn bind_handle(&self, binding: String, value: Value) -> Result<()> {
        self.lock()?.handles.insert(binding, value);
        Ok(())
    }

    pub fn remove_handle(&self, binding: &str) -> Result<Option<Value>> {
        Ok(self.lock()?.handles.remove(binding))
    }

    pub fn handles(&self) -> Result<HashMap<String, Value>> {
        Ok(self.lock()?.handles.clone())
    }

    pub fn key(&self, raw: &str) -> Result<Option<NodeKey>> {
        Ok(self.lock()?.keys.get(raw).copied())
    }

    pub fn bind_key(&self, raw: String, key: NodeKey) -> Result<()> {
        self.lock()?.keys.insert(raw, key);
        Ok(())
    }

    pub fn keys(&self) -> Result<HashMap<String, NodeKey>> {
        Ok(self.lock()?.keys.clone())
    }

    pub fn retain_keys(&self, retained: &std::collections::HashSet<String>) -> Result<()> {
        self.lock()?.keys.retain(|raw, _| retained.contains(raw));
        Ok(())
    }

    pub fn state(&self, version: &u64) -> Result<Option<EditorState>> {
        self.editor_state(0, *version)
    }

    pub fn editor_state(&self, editor: u64, version: u64) -> Result<Option<EditorState>> {
        Ok(self.lock()?.states.get(&(editor, version)).cloned())
    }

    pub fn retired_record(
        &self,
        editor: u64,
        version: u64,
        key: NodeKey,
    ) -> Result<Option<Arc<NodeRecord>>> {
        Ok(self
            .lock()?
            .retired
            .get(&(editor, version))
            .and_then(|records| records.get(&key))
            .cloned())
    }

    pub fn capture_retired_records(
        &self,
        tx: &Transaction<'_>,
        editor: u64,
        version: u64,
    ) -> Result<()> {
        for value in self.handles()?.into_values() {
            if value.get("$node").is_some()
                && value["editor"].as_u64().unwrap_or(0) == editor
                && integer(&value["ver"])? == version
            {
                let key = node_key(&value)?;
                if let Some(record) = tx.retired_record(key) {
                    self.pin_retired_record(
                        editor,
                        version,
                        key,
                        record.capture_for_foreign_read(),
                    )?;
                }
            }
        }
        Ok(())
    }

    pub fn pin_retired_record(
        &self,
        editor: u64,
        version: u64,
        key: NodeKey,
        record: NodeRecord,
    ) -> Result<()> {
        let previous = {
            self.lock()?
                .retired
                .entry((editor, version))
                .or_default()
                .insert(key, Arc::new(record))
        };
        drop(previous);
        Ok(())
    }

    pub fn pin_state(&self, version: u64, state: EditorState) -> Result<()> {
        self.pin_editor_state(0, version, state)
    }

    pub fn pin_editor_state(&self, editor: u64, version: u64, state: EditorState) -> Result<()> {
        let previous = { self.lock()?.states.insert((editor, version), state) };
        drop(previous);
        Ok(())
    }

    pub fn release_state(&self, version: u64) -> Result<()> {
        self.release_editor_state(0, version)
    }

    pub fn release_editor_state(&self, editor: u64, version: u64) -> Result<()> {
        let previous = {
            let mut values = self.lock()?;
            (
                values.states.remove(&(editor, version)),
                values.retired.remove(&(editor, version)),
            )
        };
        drop(previous);
        Ok(())
    }

    pub fn save_state(&self, state: EditorState) -> Result<usize> {
        let mut values = self.lock()?;
        let id = values.saved_states.len();
        values.saved_states.push(Some(state));
        Ok(id)
    }

    pub fn saved_owner(&self, id: usize) -> Result<Option<(u64, u64)>> {
        Ok(self.lock()?.saved_versions.get(&id).copied())
    }

    pub fn saved_state(&self, id: usize) -> Result<EditorState> {
        self.lock()?
            .saved_states
            .get(id)
            .and_then(Option::as_ref)
            .cloned()
            .ok_or_else(|| fail("unknown or released state handle"))
    }

    pub fn release_saved_state(&self, id: usize) -> Result<()> {
        let previous = {
            let mut values = self.lock()?;
            values.published_snapshots.retain(|_, cached| *cached != id);
            values.saved_versions.remove(&id);
            values.saved_states.get_mut(id).and_then(Option::take)
        };
        drop(previous);
        Ok(())
    }
}

#[cfg(test)]
mod test;
