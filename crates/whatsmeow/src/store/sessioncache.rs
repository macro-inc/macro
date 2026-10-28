// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow store/sessioncache.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::collections::HashMap;
use std::sync::Mutex;

use super::store::{Device, StoreError};

/// One cached session record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionCacheEntry {
    /// Changed since it was loaded, so it must be written back.
    pub dirty: bool,
    /// The store had a session.
    pub found: bool,
    /// The serialized record; `None` for a new session.
    pub record: Option<Vec<u8>>,
}

/// Sessions prefetched for encrypting to many devices at once, written back
/// in one batch.
///
/// Go hides the cache in the `context.Context` that libsignal passes back to
/// the store; the port passes it explicitly to [`Device::signal_store`].
#[derive(Debug, Default)]
pub struct SessionCache {
    entries: Mutex<HashMap<String, SessionCacheEntry>>,
}

impl SessionCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SessionCacheEntry>> {
        // A panic while holding the lock can't leave a half-written entry.
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The cached record of an address: `None` when the address isn't
    /// cached, `Some(None)` when it is cached as a new session.
    pub fn get_cached_session(&self, address: &str) -> Option<Option<Vec<u8>>> {
        self.lock().get(address).map(|entry| entry.record.clone())
    }

    /// Replaces a cached record and marks it dirty.
    pub fn put_cached_session(&self, address: &str, record: Vec<u8>) {
        self.lock().insert(
            address.to_owned(),
            SessionCacheEntry {
                dirty: true,
                found: true,
                record: Some(record),
            },
        );
    }
}

impl Device {
    /// Prefetches the sessions of the addresses. Returns which of them had a
    /// session, and the cache to pass to [`Device::signal_store`] and then
    /// [`Device::put_cached_sessions`].
    pub async fn with_cached_sessions(
        &self,
        addresses: &[String],
    ) -> Result<(HashMap<String, bool>, Option<SessionCache>), StoreError> {
        if addresses.is_empty() {
            return Ok((HashMap::new(), None));
        }
        let sessions = self.sessions.get_many_sessions(addresses).await?;
        let mut existing_sessions = HashMap::with_capacity(sessions.len());
        let mut wrapped = HashMap::with_capacity(sessions.len());
        for (address, record) in sessions {
            let found = record.is_some();
            existing_sessions.insert(address.clone(), found);
            wrapped.insert(
                address,
                SessionCacheEntry {
                    dirty: false,
                    found,
                    record,
                },
            );
        }
        Ok((
            existing_sessions,
            Some(SessionCache {
                entries: Mutex::new(wrapped),
            }),
        ))
    }

    /// Writes the cache's changed sessions back to the store and empties it.
    pub async fn put_cached_sessions(&self, cache: &SessionCache) -> Result<(), StoreError> {
        let dirty_sessions: HashMap<String, Vec<u8>> = cache
            .lock()
            .iter()
            .filter(|(_, entry)| entry.dirty)
            .filter_map(|(address, entry)| Some((address.clone(), entry.record.clone()?)))
            .collect();
        if !dirty_sessions.is_empty() {
            self.sessions.put_many_sessions(dirty_sessions).await?;
        }
        cache.lock().clear();
        Ok(())
    }
}

#[cfg(test)]
mod test;
