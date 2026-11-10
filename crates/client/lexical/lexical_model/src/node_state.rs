//! Typed, identity-keyed state attached to nodes owned by other packages.
use crate::Error;
use crate::collections::IndexMap;
use serde_json::Value;
use std::{
    any::Any,
    fmt,
    sync::{Arc, OnceLock},
};

/// A state value with JavaScript-compatible equality.
pub trait StateValue: Clone + fmt::Debug + Send + Sync + 'static {
    /// Serialize this value.
    fn to_json(&self) -> Value;
    /// Object.is semantics, including object identity.
    fn js_equal(&self, other: &Self) -> bool;
}
macro_rules! primitive {
    ($($ty:ty),*) => {$ (
        impl StateValue for $ty {
            fn to_json(&self) -> Value { Value::from(self.clone()) }
            fn js_equal(&self, other: &Self) -> bool { self == other }
        }
    )*};
}
primitive!(bool, String, i64, u32);
impl<T: StateValue> StateValue for Option<T> {
    fn to_json(&self) -> Value {
        self.as_ref().map_or(Value::Null, StateValue::to_json)
    }
    fn js_equal(&self, other: &Self) -> bool {
        match (self, other) {
            (None, None) => true,
            (Some(left), Some(right)) => left.js_equal(right),
            _ => false,
        }
    }
}
impl StateValue for f64 {
    fn to_json(&self) -> Value {
        crate::js_number(*self)
    }
    fn js_equal(&self, other: &Self) -> bool {
        self.to_bits() == other.to_bits() || (self.is_nan() && other.is_nan())
    }
}
impl StateValue for Arc<[String]> {
    fn to_json(&self) -> Value {
        Value::Array(self.iter().cloned().map(Value::String).collect())
    }
    fn js_equal(&self, other: &Self) -> bool {
        Arc::ptr_eq(self, other)
    }
}
impl StateValue for Arc<Value> {
    fn to_json(&self) -> Value {
        self.as_ref().clone()
    }
    fn js_equal(&self, other: &Self) -> bool {
        json_equal(self, other)
    }
}
fn json_equal(left: &Arc<Value>, right: &Arc<Value>) -> bool {
    Arc::ptr_eq(left, right)
        || match (left.as_ref(), right.as_ref()) {
            (Value::Array(_), _)
            | (Value::Object(_), _)
            | (_, Value::Array(_))
            | (_, Value::Object(_)) => false,
            (Value::Number(a), Value::Number(b)) => a
                .as_f64()
                .zip(b.as_f64())
                .is_some_and(|(a, b)| a.js_equal(&b)),
            (a, b) => a == b,
        }
}
fn serialized_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            left == right && left.as_f64().map(f64::to_bits) == right.as_f64().map(f64::to_bits)
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| serialized_equal(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, value)| {
                    right
                        .get(key)
                        .is_some_and(|right| serialized_equal(value, right))
                })
        }
        _ => left == right,
    }
}
/// A static state configuration; identity is its address.
/// s2: NS-01, NS-02
pub struct StateKey<ValueType: StateValue> {
    name: &'static str,
    parse: fn(Option<&Value>) -> ValueType,
    equal: Option<fn(&ValueType, &ValueType) -> bool>,
    reset: bool,
    default: OnceLock<ValueType>,
}
impl<ValueType: StateValue> StateKey<ValueType> {
    /// Define a key and a parser whose None case supplies its default.
    pub const fn new(name: &'static str, parse: fn(Option<&Value>) -> ValueType) -> Self {
        Self {
            name,
            parse,
            equal: None,
            reset: false,
            default: OnceLock::new(),
        }
    }
    /// Override Object.is equality.
    pub const fn with_is_equal(mut self, equal: fn(&ValueType, &ValueType) -> bool) -> Self {
        self.equal = Some(equal);
        self
    }
    /// Reset this value when copying a node.
    pub const fn reset_on_copy(mut self) -> Self {
        self.reset = true;
        self
    }
    /// Serialized name.
    pub fn name(&self) -> &'static str {
        self.name
    }
    /// Cached default, preserving object identity across reads.
    pub fn default_value(&self) -> &ValueType {
        self.default.get_or_init(|| (self.parse)(None))
    }
    /// Configured value equality.
    pub fn is_equal(&self, a: &ValueType, b: &ValueType) -> bool {
        self.equal
            .map_or_else(|| a.js_equal(b), |equal| equal(a, b))
    }
    pub(crate) fn read(&'static self, state: Option<&NodeState>) -> Result<ValueType, Error> {
        if let Some(state) = state {
            if let Some((key, value)) = state.known.iter().find(|(key, _)| key.name() == self.name)
            {
                if key.identity() != self.identity() {
                    return Err(Error::StateKeyCollision { key: self.name });
                }
                return value
                    .downcast_ref::<ValueType>()
                    .cloned()
                    .ok_or(Error::Invariant("state value type mismatch"));
            }
            if let Some(value) = state
                .unknown
                .as_ref()
                .and_then(|values| values.get(self.name))
            {
                return Ok((self.parse)(Some(value)));
            }
        }
        Ok(self.default_value().clone())
    }
}
pub(crate) trait AnyStateKey: Send + Sync {
    fn name(&self) -> &'static str;
    fn identity(&self) -> usize;
    fn reset(&self) -> bool;
    fn default_any(&'static self) -> Arc<dyn Any + Send + Sync>;
    fn parse_any(&'static self, value: Option<&Value>) -> Arc<dyn Any + Send + Sync>;
    fn equal_any(&self, a: &dyn Any, b: &dyn Any) -> bool;
    fn json_any(&self, value: &dyn Any) -> Option<Value>;
}
type SharedConfigMap = IndexMap<&'static str, &'static dyn AnyStateKey>;
#[derive(Default)]
pub(crate) struct SharedStateConfigs(
    std::sync::Mutex<crate::collections::HashMap<crate::NodeTypeIndex, SharedConfigMap>>,
);
impl SharedStateConfigs {
    pub(crate) fn learn(
        &self,
        index: crate::NodeTypeIndex,
        key: &'static dyn AnyStateKey,
    ) -> Result<(), Error> {
        let mut maps = self
            .0
            .lock()
            .map_err(|_| Error::Invariant("shared state configs poisoned"))?;
        let shared = maps.entry(index).or_default();
        if let Some(existing) = shared.get(key.name())
            && existing.identity() != key.identity()
        {
            return Err(Error::StateKeyCollision { key: key.name() });
        }
        shared.insert(key.name(), key);
        Ok(())
    }
    pub(crate) fn for_type(&self, index: crate::NodeTypeIndex) -> Result<SharedConfigMap, Error> {
        let maps = self
            .0
            .lock()
            .map_err(|_| Error::Invariant("shared state configs poisoned"))?;
        Ok(maps.get(&index).cloned().unwrap_or_default())
    }
}
impl<ValueType: StateValue> AnyStateKey for StateKey<ValueType> {
    fn name(&self) -> &'static str {
        self.name
    }
    fn identity(&self) -> usize {
        self as *const Self as usize
    }
    fn reset(&self) -> bool {
        self.reset
    }
    fn default_any(&'static self) -> Arc<dyn Any + Send + Sync> {
        Arc::new(self.default_value().clone())
    }
    fn parse_any(&'static self, value: Option<&Value>) -> Arc<dyn Any + Send + Sync> {
        Arc::new((self.parse)(value))
    }
    fn equal_any(&self, a: &dyn Any, b: &dyn Any) -> bool {
        a.downcast_ref::<ValueType>()
            .zip(b.downcast_ref::<ValueType>())
            .is_some_and(|(a, b)| self.is_equal(a, b))
    }
    fn json_any(&self, value: &dyn Any) -> Option<Value> {
        value.downcast_ref::<ValueType>().map(StateValue::to_json)
    }
}
/// A declaration retains static native identity or a runtime key name.
#[derive(Clone, Copy)]
pub(crate) enum DeclaredStateKey {
    Native(&'static dyn AnyStateKey),
    #[cfg(feature = "foreign-nodes")]
    Foreign(&'static str),
}
impl DeclaredStateKey {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Native(key) => key.name(),
            #[cfg(feature = "foreign-nodes")]
            Self::Foreign(name) => name,
        }
    }
    pub(crate) fn identity(self) -> usize {
        match self {
            Self::Native(key) => key.identity(),
            #[cfg(feature = "foreign-nodes")]
            Self::Foreign(_) => 0,
        }
    }
    fn native(self) -> Option<&'static dyn AnyStateKey> {
        match self {
            Self::Native(key) => Some(key),
            #[cfg(feature = "foreign-nodes")]
            Self::Foreign(_) => None,
        }
    }
}
/// A declared state key with nested or flat serialization.
#[derive(Clone, Copy)]
pub struct RequiredState {
    pub(crate) key: DeclaredStateKey,
    pub(crate) flat: bool,
}
impl RequiredState {
    /// Declare a registered development state key, retaining its JSON until first read.
    #[cfg(feature = "foreign-nodes")]
    pub const fn foreign(name: &'static str, flat: bool) -> Self {
        Self {
            key: DeclaredStateKey::Foreign(name),
            flat,
        }
    }

    /// Store under the `$` object.
    pub const fn nested<ValueType: StateValue>(key: &'static StateKey<ValueType>) -> Self {
        Self {
            key: DeclaredStateKey::Native(key),
            flat: false,
        }
    }
    /// Store beside the node's base properties.
    pub const fn flat<ValueType: StateValue>(key: &'static StateKey<ValueType>) -> Self {
        Self {
            key: DeclaredStateKey::Native(key),
            flat: true,
        }
    }
}
/// Validated state declarations inherited by a registered node.
#[derive(Clone, Default)]
pub struct StateLayout {
    pub(crate) entries: Vec<RequiredState>,
}
/// Optional node state; known entries preserve insertion order and value identity.
#[derive(Clone, Default)]
pub struct NodeState {
    pub(crate) known: Vec<(&'static dyn AnyStateKey, Arc<dyn Any + Send + Sync>)>,
    pub(crate) unknown: Option<IndexMap<String, Arc<Value>>>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign: crate::foreign::state::ForeignBindings,
}
impl fmt::Debug for NodeState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NodeState")
            .field("known", &self.known_names().collect::<Vec<_>>())
            .field("unknown", &self.unknown)
            .finish()
    }
}
impl NodeState {
    pub(crate) fn clone_for_write(&self, shared: &SharedConfigMap) -> Self {
        let mut next = self.clone();
        if let Some(unknown) = &mut next.unknown {
            unknown.retain(|name, value| {
                if let Some(key) = shared.get(name.as_str()) {
                    if !next
                        .known
                        .iter()
                        .any(|(known, _)| known.identity() == key.identity())
                    {
                        next.known.push((*key, key.parse_any(Some(value))));
                    }
                    false
                } else {
                    true
                }
            });
        }
        next
    }
    /// Unparsed imported state.
    pub fn unknown(&self) -> Option<&IndexMap<String, Arc<Value>>> {
        self.unknown.as_ref()
    }
    /// Known keys in insertion order.
    pub fn known_names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.known.iter().map(|(k, _)| k.name())
    }
    /// Compare states using each key's equality and unknown JSON object identity.
    /// s2: NS-15, NS-16
    pub fn equivalent(left: Option<&Self>, right: Option<&Self>) -> bool {
        let empty = Self::default();
        let left = left.unwrap_or(&empty);
        let right = right.unwrap_or(&empty);
        let mut keys = IndexMap::default();
        for (key, _) in left.known.iter().chain(&right.known) {
            if let Some(previous) = keys.insert(key.name(), *key)
                && previous.identity() != key.identity()
            {
                return false;
            }
        }
        for key in keys.values() {
            let value = |state: &Self| {
                state
                    .known
                    .iter()
                    .find(|(candidate, _)| candidate.identity() == key.identity())
                    .map(|(_, value)| value.clone())
                    .unwrap_or_else(|| {
                        state
                            .unknown
                            .as_ref()
                            .and_then(|values| values.get(key.name()))
                            .map_or_else(|| key.default_any(), |value| key.parse_any(Some(value)))
                    })
            };
            let a = value(left);
            let b = value(right);
            if !Arc::ptr_eq(&a, &b) && !key.equal_any(a.as_ref(), b.as_ref()) {
                return false;
            }
        }
        #[cfg(feature = "foreign-nodes")]
        let Some(foreign) = crate::foreign::state::equivalent(left, right) else {
            return false;
        };
        left.unknown
            .iter()
            .flatten()
            .chain(right.unknown.iter().flatten())
            .all(|(name, _)| {
                let known = keys.contains_key(name.as_str());
                #[cfg(feature = "foreign-nodes")]
                let known = known || foreign.contains_key(name.as_str());
                known
                    || left
                        .unknown
                        .as_ref()
                        .and_then(|values| values.get(name))
                        .zip(right.unknown.as_ref().and_then(|values| values.get(name)))
                        .is_some_and(|(a, b)| json_equal(a, b))
            })
    }

    pub(crate) fn set<ValueType: StateValue>(
        &mut self,
        key: &'static StateKey<ValueType>,
        value: ValueType,
    ) -> Result<(), Error> {
        if let Some((existing, stored)) = self.known.iter_mut().find(|(k, _)| k.name() == key.name)
        {
            if existing.identity() != key.identity() {
                return Err(Error::StateKeyCollision { key: key.name });
            }
            *stored = Arc::new(value);
        } else {
            self.known.push((key, Arc::new(value)));
        }
        // updateFromKnown retains an existing unknown slot. Export overwrites
        // its value in place; a later JSON import prunes learned configs.
        Ok(())
    }
    pub(crate) fn reset_copy(&mut self) {
        for (key, value) in &mut self.known {
            if key.reset() {
                *value = key.default_any();
            }
        }
    }
    /// s2: NS-09, NS-12
    pub(crate) fn import(
        json: &crate::SerializedNode,
        layout: &StateLayout,
        previous: Option<&NodeState>,
        shared: Option<&IndexMap<&'static str, &'static dyn AnyStateKey>>,
        preserve_unchanged: bool,
    ) -> Option<Self> {
        let nested = json.get("$").and_then(Value::as_object);
        if previous.is_none()
            && nested.is_none()
            && !layout
                .entries
                .iter()
                .any(|entry| entry.flat && json.contains_key(entry.key.name()))
        {
            return None;
        }
        let mut unknown: IndexMap<_, _> = nested
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), Arc::new(v.clone())))
            .collect();
        for entry in &layout.entries {
            if entry.flat
                && let Some(v) = json.get(entry.key.name())
            {
                unknown.insert(entry.key.name().to_owned(), Arc::new(v.clone()));
            }
        }
        let mut known = vec![];
        let parse = |key: &'static dyn AnyStateKey, value: Option<Arc<Value>>| {
            if preserve_unchanged
                && let Some((_, stored)) = previous
                    .into_iter()
                    .flat_map(|state| &state.known)
                    .find(|(existing, _)| existing.identity() == key.identity())
                && match &value {
                    Some(value) => {
                        !key.equal_any(stored.as_ref(), key.default_any().as_ref())
                            && key
                                .json_any(stored.as_ref())
                                .is_some_and(|stored| serialized_equal(&stored, value))
                    }
                    None => key.equal_any(stored.as_ref(), key.default_any().as_ref()),
                }
            {
                // Remote updates carry the whole node, including unchanged state.
                // Reparsing an unchanged typed value can alter its serialized shape.
                return stored.clone();
            }
            value.map_or_else(|| key.default_any(), |value| key.parse_any(Some(&value)))
        };
        for entry in &layout.entries {
            let Some(key) = entry.key.native() else {
                continue;
            };
            let value = unknown.shift_remove(key.name());
            known.push((key, parse(key, value)));
        }
        if let Some(previous) = previous {
            for (key, _) in &previous.known {
                if known
                    .iter()
                    .any(|(existing, _)| existing.identity() == key.identity())
                {
                    continue;
                }
                let value = unknown.shift_remove(key.name());
                known.push((*key, parse(*key, value)));
            }
        }
        let learned: Vec<_> = unknown
            .keys()
            .filter_map(|name| shared.and_then(|shared| shared.get(name.as_str())).copied())
            .collect();
        for key in learned {
            let value = unknown.shift_remove(key.name());
            if !known
                .iter()
                .any(|(existing, _)| existing.identity() == key.identity())
            {
                known.push((key, parse(key, value)));
            }
        }
        Some(Self {
            known,
            unknown: Some(unknown),
            #[cfg(feature = "foreign-nodes")]
            foreign: previous
                .map(|state| state.foreign.clone())
                .unwrap_or_default(),
        })
    }
    /// s2: NS-08
    pub(crate) fn export(&self, layout: &StateLayout, json: &mut crate::SerializedNode) {
        drop(self.export_reusing(layout, json, crate::SerializedNode::new()));
    }
    pub(crate) fn export_reusing(
        &self,
        layout: &StateLayout,
        json: &mut crate::SerializedNode,
        mut values: crate::SerializedNode,
    ) -> crate::SerializedNode {
        values.clear();
        values.extend(
            self.unknown
                .iter()
                .flatten()
                .map(|(key, value)| (key.clone(), value.as_ref().clone())),
        );
        for (key, value) in &self.known {
            if key.equal_any(value.as_ref(), key.default_any().as_ref()) {
                values.shift_remove(key.name());
            } else if let Some(v) = key.json_any(value.as_ref()) {
                values.insert(key.name().to_owned(), v);
            }
        }
        #[cfg(feature = "foreign-nodes")]
        self.foreign.export(&mut values, layout, json);
        for entry in &layout.entries {
            if entry.flat
                && let Some(value) = values.shift_remove(entry.key.name())
            {
                json.insert(entry.key.name().to_owned(), value);
            }
        }
        if !values.is_empty() {
            json.insert("$".into(), Value::Object(std::mem::take(&mut values)));
        }
        values
    }
}

impl PartialEq for NodeState {
    fn eq(&self, other: &Self) -> bool {
        Self::equivalent(Some(self), Some(other))
    }
}
