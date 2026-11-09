//! Runtime NodeState codecs over unparsed JSON slots.
use crate::{collections::IndexMap, node_state::DeclaredStateKey, *};
use serde_json::Value;
use std::{
    borrow::Cow,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

/// One development JS StateConfig; codec identity distinguishes configs with the same key.
#[derive(Clone)]
pub struct ForeignStateConfig {
    /// Serialized state key.
    pub key: Arc<str>,
    /// Flat serialization unless a node's explicit declaration specifies otherwise.
    pub flat: bool,
    /// Host equality and default-value behavior.
    pub codec: Arc<dyn ForeignStateCodec>,
}
/// Host callbacks for parsed state equality and default omission.
pub trait ForeignStateCodec: Send + Sync + 'static {
    /// Compare the parsed values of two unparsed JSON slots.
    fn is_equal(&self, a: &Value, b: &Value) -> bool;
    /// Whether the parsed slot equals this config's default value.
    fn is_default(&self, value: &Value) -> bool;
}
type Configs = IndexMap<&'static str, Arc<ForeignStateConfig>>;

/// Registration is shared by snapshots; guards are dropped before any codec callout.
#[derive(Default)]
pub(crate) struct ForeignStateRegistry {
    configs: RwLock<Configs>,
    populated: AtomicBool,
}
impl ForeignStateRegistry {
    pub(crate) fn register(&self, config: ForeignStateConfig) -> Result<(), &'static str> {
        let mut configs = self
            .configs
            .write()
            .unwrap_or_else(|error| error.into_inner());
        if let Some((name, existing)) = configs.get_key_value(config.key.as_ref()) {
            if existing.flat == config.flat && Arc::ptr_eq(&existing.codec, &config.codec) {
                return Ok(());
            }
            return Err(name);
        }
        // Like runtime type names, one state name is interned per editor registration.
        // The leaked name contains no callbacks or JS values.
        let name = Box::leak(config.key.to_string().into_boxed_str());
        configs.insert(name, Arc::new(config));
        self.populated.store(true, Ordering::Release);
        Ok(())
    }
    pub(crate) fn layout<'a>(&self, layout: &'a StateLayout) -> Cow<'a, StateLayout> {
        if !self.populated.load(Ordering::Acquire) {
            return Cow::Borrowed(layout);
        }
        let mut layout = layout.clone();
        let configs = self
            .configs
            .read()
            .unwrap_or_else(|error| error.into_inner());
        for (name, config) in configs.iter() {
            if config.flat && !layout.entries.iter().any(|entry| entry.key.name() == *name) {
                layout.entries.push(RequiredState::foreign(name, true));
            }
        }
        Cow::Owned(layout)
    }
    fn get(&self, key: &str) -> Option<(&'static str, Arc<ForeignStateConfig>)> {
        if !self.populated.load(Ordering::Acquire) {
            return None;
        }
        self.configs
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .get_key_value(key)
            .map(|(name, config)| (*name, config.clone()))
    }
}
/// A read memo: imported slots stay unknown until a config is actually read or written.
#[derive(Default)]
pub(crate) struct ForeignBindings {
    configs: Mutex<Configs>,
    populated: AtomicBool,
}
impl Clone for ForeignBindings {
    fn clone(&self) -> Self {
        let configs = self.configs();
        Self {
            populated: AtomicBool::new(!configs.is_empty()),
            configs: Mutex::new(configs),
        }
    }
}
impl ForeignBindings {
    fn configs(&self) -> Configs {
        if !self.populated.load(Ordering::Acquire) {
            return Configs::default();
        }
        self.configs
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
    fn bind(&self, name: &'static str, config: Arc<ForeignStateConfig>) {
        self.configs
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entry(name)
            .or_insert(config);
        self.populated.store(true, Ordering::Release);
    }
    pub(crate) fn contains(&self, name: &str) -> bool {
        self.populated.load(Ordering::Acquire)
            && self
                .configs
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .contains_key(name)
    }
    pub(crate) fn export(
        &self,
        values: &mut SerializedNode,
        layout: &StateLayout,
        json: &mut SerializedNode,
    ) {
        let configs = self.configs();
        for (name, config) in configs {
            if ForeignReadOperation::check().is_err() {
                return;
            }
            let is_default = values
                .get(name)
                .is_some_and(|value| config.codec.is_default(value));
            if ForeignReadOperation::check().is_err() {
                return;
            }
            if is_default {
                values.shift_remove(name);
            }
            let flat = layout
                .entries
                .iter()
                .find(|entry| entry.key.name() == name)
                .map_or(config.flat, |entry| entry.flat);
            if flat && let Some(value) = values.shift_remove(name) {
                json.insert(name.into(), value);
            }
        }
    }
}

pub(crate) fn equivalent(left: &NodeState, right: &NodeState) -> Option<Configs> {
    let mut configs = left.foreign.configs();
    for (name, config) in right.foreign.configs() {
        if let Some(existing) = configs.get(name)
            && !Arc::ptr_eq(&existing.codec, &config.codec)
        {
            return None;
        }
        configs.insert(name, config);
    }
    for (name, config) in &configs {
        if ForeignReadOperation::check().is_err() {
            return None;
        }
        let a = left.unknown.as_ref().and_then(|values| values.get(*name));
        let b = right.unknown.as_ref().and_then(|values| values.get(*name));
        let equal = match (a, b) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b) || config.codec.is_equal(a, b),
            (Some(value), None) | (None, Some(value)) => config.codec.is_default(value),
            (None, None) => true,
        };
        if ForeignReadOperation::check().is_err() {
            return None;
        }
        if !equal {
            return None;
        }
    }
    Some(configs)
}

pub(crate) fn validate_declarations(registry: &Registry) -> Result<(), BuildError> {
    for node in registry.types() {
        for entry in &node.state_layout.entries {
            if let DeclaredStateKey::Foreign(name) = entry.key
                && registry.foreign_states.get(name).is_none()
            {
                return Err(BuildError::UnknownForeignState { key: name });
            }
        }
    }
    Ok(())
}
impl EditorBuilder {
    /// Register a JS state config before construction; imported values remain unparsed.
    pub fn foreign_state(mut self, config: ForeignStateConfig) -> Self {
        self.foreign_states.push(config);
        self
    }
}
impl Editor {
    /// Register a JS state config created after editor construction.
    pub fn register_foreign_state(&mut self, config: ForeignStateConfig) -> Result<(), Error> {
        self.state
            .registry
            .foreign_states
            .register(config)
            .map_err(|key| Error::StateKeyCollision { key })
    }
}
impl Transaction<'_> {
    /// Register a JS state config during a host callback.
    pub fn register_foreign_state(&mut self, config: ForeignStateConfig) -> Result<(), Error> {
        self.guard_write()?;
        self.editor.register_foreign_state(config)
    }
    /// Set an already-unparsed host value, retaining unknown slots and custom equality.
    pub fn set_foreign_state(
        &mut self,
        node: impl Into<NodeKey>,
        key: &str,
        value: Value,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let node = node.into();
        let (name, config) = self
            .pending
            .registry
            .foreign_states
            .get(key)
            .ok_or_else(|| Error::UnknownForeignState { key: key.into() })?;
        let slot = self
            .pending
            .nodes
            .get(&node)
            .ok_or(Error::NodeNotFound(node))?;
        let layout = &self
            .pending
            .registry
            .registered(slot.type_index)
            .state_layout;
        if layout.entries.iter().any(|entry| {
            entry.key.name() == name && matches!(entry.key, DeclaredStateKey::Native(_))
        }) {
            return Err(Error::StateKeyCollision { key: name });
        }
        let state = slot.state.clone();
        if let Some(state) = &state {
            if state.known.iter().any(|(key, _)| key.name() == name) {
                return Err(Error::StateKeyCollision { key: name });
            }
            state.foreign.bind(name, config.clone());
        }
        let previous = state
            .as_ref()
            .and_then(|state| state.unknown.as_ref())
            .and_then(|values| values.get(key))
            .cloned();
        let equal = self.with_foreign_call(|_| {
            Ok(match previous {
                Some(previous) => config.codec.is_equal(&previous, &value),
                None => config.codec.is_default(&value),
            })
        })?;
        if equal {
            return Ok(());
        }
        let slot = self.writable(node)?;
        let state = slot
            .state
            .get_or_insert_with(|| Arc::new(NodeState::default()));
        let state = Arc::make_mut(state);
        state.foreign.bind(name, config);
        state
            .unknown
            .get_or_insert_with(IndexMap::default)
            .insert(key.to_owned(), Arc::new(value));
        Ok(())
    }
}
impl<'state> StateRef<'state> {
    /// Read an unparsed slot and lazily bind its registered codec without dirtying the node.
    pub fn foreign_state(self, node: impl Into<NodeKey>, key: &str) -> Option<&'state Value> {
        if ForeignReadOperation::check().is_err() {
            return None;
        }
        let state = self.slot(node.into())?.state.as_deref()?;
        if let Some((name, config)) = self.state.registry.foreign_states.get(key) {
            state.foreign.bind(name, config);
        }
        state.unknown.as_ref()?.get(key).map(AsRef::as_ref)
    }
}

#[cfg(test)]
mod test;
