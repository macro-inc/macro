//! The per-user single-stream guard.

#[cfg(test)]
mod test;

use std::{
    collections::HashSet,
    hash::Hash,
    sync::{Arc, Mutex, PoisonError},
};

/// Keys (users) with an open stream in this process.
#[derive(Debug)]
pub struct ActiveStreams<K> {
    keys: Arc<Mutex<HashSet<K>>>,
}

impl<K> Default for ActiveStreams<K> {
    fn default() -> Self {
        Self {
            keys: Arc::default(),
        }
    }
}

/// Holds a key's slot until dropped.
#[derive(Debug)]
pub struct ActiveStreamGuard<K: Hash + Eq> {
    keys: Arc<Mutex<HashSet<K>>>,
    key: K,
}

impl<K: Hash + Eq + Clone> ActiveStreams<K> {
    /// Claims `key`'s slot; `None` when `key` already holds one.
    pub fn try_acquire(&self, key: K) -> Option<ActiveStreamGuard<K>> {
        let inserted = self
            .keys
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key.clone());
        inserted.then(|| ActiveStreamGuard {
            keys: Arc::clone(&self.keys),
            key,
        })
    }
}

impl<K: Hash + Eq> Drop for ActiveStreamGuard<K> {
    fn drop(&mut self) {
        self.keys
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.key);
    }
}
