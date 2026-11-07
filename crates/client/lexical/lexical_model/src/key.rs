//! Generation-aware editor keys.
use crate::Error;
use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

/// Editor-scoped identity, ordered by generation and allocation index.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
/// s2: ID-01
pub struct NodeKey {
    generation: u32,
    index: u32,
}
/// Named halves of a key for boundary encoding.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct KeyParts {
    /// Counter generation.
    pub generation: u32,
    /// Allocation index; zero denotes the root.
    pub index: u32,
}
impl NodeKey {
    /// The root is valid in every generation.
    pub const ROOT: Self = Self {
        generation: 0,
        index: 0,
    };
    /// Rebuild a key, canonicalizing root.
    pub const fn from_parts(parts: KeyParts) -> Self {
        if parts.index == 0 {
            Self::ROOT
        } else {
            Self {
                generation: parts.generation,
                index: parts.index,
            }
        }
    }
    /// Allocation index.
    pub const fn index(self) -> u32 {
        self.index
    }
    /// Counter generation.
    pub const fn generation(self) -> u32 {
        self.generation
    }
    /// Named boundary representation.
    pub const fn parts(self) -> KeyParts {
        KeyParts {
            generation: self.generation,
            index: self.index,
        }
    }
}
impl fmt::Display for NodeKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.index == 0 {
            f.write_str("root")
        } else {
            self.index.fmt(f)
        }
    }
}
/// A cloneable shared allocation counter, never rolled back with a transaction.
#[derive(Clone, Debug, Default)]
pub struct SharedKeyCounter(Arc<AtomicU64>);
impl SharedKeyCounter {
    /// An independent counter.
    pub fn new() -> Self {
        Self::default()
    }
    /// Advance the generation and restart numbering; fail on generation exhaustion.
    pub fn reset(&self) -> Result<(), Error> {
        self.0
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                let generation = u32::try_from(n >> 32).ok()?.checked_add(1)?;
                Some(u64::from(generation) << 32)
            })
            .map(|_| ())
            .map_err(|_| Error::KeySpaceExhausted)
    }
    pub(crate) fn next(&self) -> Result<NodeKey, Error> {
        let previous = self
            .0
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                if n & u64::from(u32::MAX) == u64::from(u32::MAX) {
                    None
                } else {
                    Some(n + 1)
                }
            })
            .map_err(|_| Error::KeySpaceExhausted)?;
        let parts = KeyParts {
            generation: u32::try_from(previous >> 32).map_err(|_| Error::KeySpaceExhausted)?,
            index: u32::try_from(previous & u64::from(u32::MAX))
                .map_err(|_| Error::KeySpaceExhausted)?
                + 1,
        };
        Ok(NodeKey::from_parts(parts))
    }
}
/// Allocation policy for an editor.
#[derive(Clone, Debug, Default)]
pub enum KeySource {
    /// Independent editor-local numbering.
    #[default]
    PerEditor,
    /// Numbering shared explicitly across editors.
    Shared(SharedKeyCounter),
}
#[cfg(test)]
mod test;

/// A key with proof of registered node ancestry at the time it was obtained.
/// s2: ID-01
pub struct Id<Node: crate::NodeType> {
    key: NodeKey,
    node_type: std::marker::PhantomData<fn() -> Node>,
}
impl<Node: crate::NodeType> Id<Node> {
    pub(crate) fn new_unchecked(key: NodeKey) -> Self {
        Self {
            key,
            node_type: std::marker::PhantomData,
        }
    }
    /// The untyped identity.
    pub fn key(self) -> NodeKey {
        self.key
    }
    /// Move one level up the declared parent chain.
    pub fn upcast(self) -> Id<crate::ParentOf<Node>> {
        Id::new_unchecked(self.key)
    }
}
impl<Node: crate::NodeType> Copy for Id<Node> {}
impl<Node: crate::NodeType> Clone for Id<Node> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<Node: crate::NodeType> PartialEq for Id<Node> {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key
    }
}
impl<Node: crate::NodeType> Eq for Id<Node> {}
impl<Node: crate::NodeType> std::hash::Hash for Id<Node> {
    fn hash<Hasher: std::hash::Hasher>(&self, h: &mut Hasher) {
        self.key.hash(h);
    }
}
impl<Node: crate::NodeType> fmt::Debug for Id<Node> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.key.fmt(f)
    }
}
impl<Node: crate::NodeType> fmt::Display for Id<Node> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.key.fmt(f)
    }
}
impl<Node: crate::NodeType> From<Id<Node>> for NodeKey {
    fn from(id: Id<Node>) -> Self {
        id.key
    }
}
