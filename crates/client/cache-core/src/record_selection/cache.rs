//! Bounded reuse of validated fragment plans across cache hosts.
use super::{RecordSelection, RecordSelectionError};
use lru::LruCache;
use std::{num::NonZeroUsize, sync::Arc};

const CAPACITY: usize = 128;

/// Reuses successful fragment plans by document text and fragment name.
pub struct RecordSelectionCache {
    plans: LruCache<(String, String), Arc<RecordSelection>>,
}

impl Default for RecordSelectionCache {
    fn default() -> Self {
        Self {
            plans: LruCache::new(NonZeroUsize::new(CAPACITY).unwrap()),
        }
    }
}

impl RecordSelectionCache {
    /// Returns a validated plan, parsing only on a cache miss.
    pub fn get(
        &mut self,
        document: String,
        fragment: String,
    ) -> Result<Arc<RecordSelection>, RecordSelectionError> {
        let key = (document, fragment);
        if let Some(selection) = self.plans.get(&key) {
            return Ok(Arc::clone(selection));
        }
        let selection = Arc::new(RecordSelection::parse(&key.0, &key.1)?);
        self.plans.put(key, Arc::clone(&selection));
        Ok(selection)
    }
}

#[cfg(test)]
mod test;
