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
    states: HashMap<u64, EditorState>,
    retired: HashMap<u64, HashMap<NodeKey, Arc<NodeRecord>>>,
    saved_states: Vec<Option<EditorState>>,
    published_snapshot: Option<(u64, usize)>,
    identities: HashMap<String, u32>,
    owners: HashMap<u32, u64>,
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
        values.owners.insert(id, owner);
        values.handles.insert(format!("{tag}:{id}"), value.clone());
        Ok((id, true))
    }

    pub fn bind_host_key(&self, key: NodeKey, id: u32) -> Result<()> {
        let mut values = self.lock()?;
        values.keys.insert(key.to_string(), key);
        values.identities.insert(format!("key:{key}"), id);
        Ok(())
    }

    pub fn release_identities(&self, version: u64) -> Result<std::collections::HashSet<u32>> {
        let mut values = self.lock()?;
        let released = values
            .owners
            .iter()
            .filter_map(|(id, owner)| (*owner == version).then_some(*id))
            .collect::<std::collections::HashSet<_>>();
        values.owners.retain(|_, owner| *owner != version);
        values.identities.retain(|_, id| !released.contains(id));
        Ok(released)
    }

    /// All frames share the identity of the currently published editor state.
    pub fn published_state(&self, version: u64, state: &EditorState) -> Result<usize> {
        let mut values = self.lock()?;
        if let Some((cached_version, id)) = values.published_snapshot
            && cached_version == version
        {
            return Ok(id);
        }
        let id = values.saved_states.len();
        values.saved_states.push(Some(state.clone()));
        values.published_snapshot = Some((version, id));
        Ok(id)
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
        Ok(self.lock()?.states.get(version).cloned())
    }

    pub fn retired_record(&self, version: u64, key: NodeKey) -> Result<Option<Arc<NodeRecord>>> {
        Ok(self
            .lock()?
            .retired
            .get(&version)
            .and_then(|records| records.get(&key))
            .cloned())
    }

    pub fn capture_retired_records(&self, tx: &Transaction<'_>, version: u64) -> Result<()> {
        for value in self.handles()?.into_values() {
            if value.get("$node").is_some() && integer(&value["ver"])? == version {
                let key = node_key(&value)?;
                if let Some(record) = tx.retired_record(key) {
                    self.pin_retired_record(version, key, record.capture_for_foreign_read())?;
                }
            }
        }
        Ok(())
    }

    pub fn pin_retired_record(&self, version: u64, key: NodeKey, record: NodeRecord) -> Result<()> {
        let previous = {
            self.lock()?
                .retired
                .entry(version)
                .or_default()
                .insert(key, Arc::new(record))
        };
        drop(previous);
        Ok(())
    }

    pub fn pin_state(&self, version: u64, state: EditorState) -> Result<()> {
        let previous = { self.lock()?.states.insert(version, state) };
        drop(previous);
        Ok(())
    }

    pub fn release_state(&self, version: u64) -> Result<()> {
        let previous = {
            let mut values = self.lock()?;
            (
                values.states.remove(&version),
                values.retired.remove(&version),
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
            if values
                .published_snapshot
                .is_some_and(|(_, cached)| cached == id)
            {
                values.published_snapshot = None;
            }
            values.saved_states.get_mut(id).and_then(Option::take)
        };
        drop(previous);
        Ok(())
    }
}

#[cfg(test)]
mod test;
