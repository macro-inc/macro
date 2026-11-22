//! Read-only state parsing; no node write barrier or user callback runs under a map lock.
use super::{AnyStateKey, KnownValues, StoredValue};
use crate::{Error, collections::IndexMap};
use serde_json::Value;
use std::{
    sync::{Mutex, MutexGuard},
    thread::{self, ThreadId},
};

struct Completed {
    key: &'static dyn AnyStateKey,
    value: StoredValue,
    publisher: ThreadId,
}
#[derive(Default)]
struct Entries {
    configs: IndexMap<&'static str, &'static dyn AnyStateKey>,
    completed: Vec<Completed>,
}
impl Entries {
    fn check(&self, key: &'static dyn AnyStateKey) -> Result<(), Error> {
        if let Some(previous) = self.configs.get(key.name())
            && previous.identity() != key.identity()
        {
            return Err(Error::StateKeyCollision { key: key.name() });
        }
        Ok(())
    }
}
#[derive(Default)]
pub(super) struct ReadMemo(Mutex<Entries>);
impl ReadMemo {
    fn entries(&self) -> MutexGuard<'_, Entries> {
        // User parsing, equality, serialization and value destruction happen outside this lock.
        match self.0.lock() {
            Ok(entries) => entries,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
    pub(super) fn get(&self, key: &'static dyn AnyStateKey) -> Result<Option<StoredValue>, Error> {
        let entries = self.entries();
        entries.check(key)?;
        Ok(entries
            .completed
            .iter()
            .find(|entry| entry.key.identity() == key.identity())
            .map(|entry| entry.value.clone()))
    }
    pub(super) fn read(
        &self,
        key: &'static dyn AnyStateKey,
        raw: &Value,
    ) -> Result<StoredValue, Error> {
        {
            let mut entries = self.entries();
            entries.check(key)?;
            if let Some(entry) = entries
                .completed
                .iter()
                .find(|entry| entry.key.identity() == key.identity())
            {
                return Ok(entry.value.clone());
            }
            entries.configs.entry(key.name()).or_insert(key);
        }
        // Optimistic parsing permits same-key and cross-key reentry, including panic/retry.
        let parsed = key.parse_any(Some(raw));
        let publisher = thread::current().id();
        let (result, replaced) = {
            let mut entries = self.entries();
            entries.check(key)?;
            if let Some(entry) = entries
                .completed
                .iter_mut()
                .find(|entry| entry.key.identity() == key.identity())
            {
                if entry.publisher == publisher {
                    // Lexical's outer updateFromKnown overwrites a nested result in place.
                    let replaced = std::mem::replace(&mut entry.value, parsed.clone());
                    (parsed, Some(replaced))
                } else {
                    // Independent racing callers share the first completed typed value.
                    (entry.value.clone(), None)
                }
            } else {
                entries.completed.push(Completed {
                    key,
                    value: parsed.clone(),
                    publisher,
                });
                (parsed, None)
            }
        };
        drop(replaced);
        Ok(result)
    }
    pub(super) fn at(&self, index: usize) -> Option<(&'static dyn AnyStateKey, StoredValue)> {
        self.entries()
            .completed
            .get(index)
            .map(|entry| (entry.key, entry.value.clone()))
    }
    #[cfg(feature = "foreign-nodes")]
    pub(super) fn contains_config(&self, name: &str) -> bool {
        self.entries().configs.contains_key(name)
    }
    pub(super) fn clone_configs(&self) -> Self {
        Self(Mutex::new(Entries {
            configs: self.entries().configs.clone(),
            completed: Vec::new(),
        }))
    }
    pub(super) fn take_values(&mut self) -> KnownValues {
        let entries = match self.0.get_mut() {
            Ok(entries) => entries,
            Err(poisoned) => poisoned.into_inner(),
        };
        entries.configs.clear();
        std::mem::take(&mut entries.completed)
            .into_iter()
            .map(|entry| (entry.key, entry.value))
            .collect()
    }
}

#[cfg(test)]
mod test;
