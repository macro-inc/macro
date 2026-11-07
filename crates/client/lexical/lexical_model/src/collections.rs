//! Deterministic hashing for parsed CSS declarations.
use rustc_hash::FxHasher;
use std::hash::BuildHasherDefault;
pub(crate) type IndexMap<Key, Value> = indexmap::IndexMap<Key, Value, BuildHasherDefault<FxHasher>>;
