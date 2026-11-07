//! Clock-injected presence port and the shared protocol store adapter.

use crate::{PeerPresence, UnixMillis};

/// Failure applying a presence payload; document recovery must not be triggered by this.
#[derive(Debug, thiserror::Error)]
#[error("invalid presence payload")]
pub struct PresenceError;

/// S7 presence operations. Implementations must use supplied wall time, never a clock read.
pub trait PresenceBackend {
    /// Set one local value; clearing is a Null value, not deletion.
    fn set(
        &mut self,
        key: &str,
        value: loro::LoroValue,
        now: UnixMillis,
    ) -> Result<(), PresenceError>;
    /// Merge received wire bytes.
    fn apply(&mut self, bytes: &[u8], now: UnixMillis) -> Result<(), PresenceError>;
    /// Encode one key in the shared presence wire format.
    fn encode(&self, key: &str, now: UnixMillis) -> Result<Vec<u8>, PresenceError>;
    /// Encode every key for the AI worker's fixed-key refresh.
    fn encode_all(&self, now: UnixMillis) -> Result<Vec<u8>, PresenceError>;
    /// Drop expired entries and return whether the visible peer list changed.
    fn remove_outdated(&mut self, now: UnixMillis) -> bool;
    /// Return remote nonempty selections, excluding the specified local key.
    fn peers(&self, local_key: &str) -> Vec<PeerPresence>;
    /// Return the next wall-clock expiry. The core translates it to its supplied monotonic clock.
    fn next_expiry(&self) -> Option<UnixMillis>;
}

/// Shared Loro-compatible presence serialization with caller-supplied wall time.
/// Iteration exposed to the core is ordered by key.
pub struct ProtocolPresence {
    store: sync_protocol::presence::EphemeralStore,
}

impl ProtocolPresence {
    /// Use the same inactivity timeout as the session's presence policy.
    pub fn new(timeout: crate::WallDuration) -> Self {
        Self {
            store: sync_protocol::presence::EphemeralStore::new(timeout.0),
        }
    }
}

impl PresenceBackend for ProtocolPresence {
    fn set(
        &mut self,
        key: &str,
        value: loro::LoroValue,
        now: UnixMillis,
    ) -> Result<(), PresenceError> {
        self.store.set(key, value, now);
        Ok(())
    }

    fn apply(&mut self, bytes: &[u8], now: UnixMillis) -> Result<(), PresenceError> {
        self.store.apply(bytes, now).map_err(|_| PresenceError)?;
        Ok(())
    }

    fn encode(&self, key: &str, now: UnixMillis) -> Result<Vec<u8>, PresenceError> {
        Ok(self.store.encode(key, now))
    }

    fn encode_all(&self, now: UnixMillis) -> Result<Vec<u8>, PresenceError> {
        Ok(self.store.encode_all(now))
    }

    fn remove_outdated(&mut self, now: UnixMillis) -> bool {
        let before = self.peers("");
        self.store.remove_outdated(now);
        before != self.peers("")
    }

    fn peers(&self, local_key: &str) -> Vec<PeerPresence> {
        let ordered: std::collections::BTreeMap<_, _> =
            self.store.get_all_states().into_iter().collect();
        ordered
            .into_iter()
            .filter(|(key, value)| key != local_key && *value != loro::LoroValue::Null)
            .map(|(key, value)| PeerPresence { key, value })
            .collect()
    }

    fn next_expiry(&self) -> Option<UnixMillis> {
        self.store.next_expiry()
    }
}

#[cfg(test)]
mod test;
