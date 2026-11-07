//! Clock-injected presence port. Production store wiring is supplied by WP-42.

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
