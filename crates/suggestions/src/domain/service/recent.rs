//! A small in-memory memo: what was last seen for a key, kept for a while,
//! so a hot read path skips work it did a moment ago.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tokio::time::Instant;

#[cfg(test)]
mod test;

/// Values remembered per key for `keep`, at most `capacity` keys.
pub(super) struct Recent<V> {
    keep: Duration,
    capacity: usize,
    entries: Mutex<HashMap<String, (Instant, V)>>,
}

impl<V: Clone> Recent<V> {
    /// Remember each value for `keep`, for at most `capacity` keys.
    pub(super) fn new(keep: Duration, capacity: usize) -> Self {
        Self {
            keep,
            capacity,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// The value remembered for `key` within `keep` of `now`.
    pub(super) fn get(&self, key: &str, now: Instant) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries
            .get(key)
            .filter(|(at, _)| now.duration_since(*at) < self.keep)
            .map(|(_, value)| value.clone())
    }

    /// Remember `value` for `key` from `now`. When full, forgets what is
    /// stale, then everything if that isn't enough.
    pub(super) fn put(&self, key: &str, value: V, now: Instant) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if entries.len() >= self.capacity && !entries.contains_key(key) {
            entries.retain(|_, (at, _)| now.duration_since(*at) < self.keep);
            if entries.len() >= self.capacity {
                entries.clear();
            }
        }
        entries.insert(key.to_owned(), (now, value));
    }
}
