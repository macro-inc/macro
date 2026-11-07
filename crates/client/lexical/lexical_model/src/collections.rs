//! Deterministic hashers for model-owned maps; no platform entropy is consulted.
use rustc_hash::FxHasher;
use std::hash::BuildHasherDefault;
pub(crate) type IndexMap<Key, ValueType> =
    indexmap::IndexMap<Key, ValueType, BuildHasherDefault<FxHasher>>;
pub(crate) type IndexSet<Key> = indexmap::IndexSet<Key, BuildHasherDefault<FxHasher>>;
pub(crate) type HashMap<Key, ValueType> =
    std::collections::HashMap<Key, ValueType, BuildHasherDefault<FxHasher>>;
