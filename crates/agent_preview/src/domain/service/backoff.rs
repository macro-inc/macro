//! Per-replica backoff for refused SSH credentials.
//!
//! Storage consumes an SSH credential on its first claim, accepted or not, so a
//! refused credential can never be accepted later. A client retrying one in a
//! loop only reaches storage again after a delay that doubles per refusal.
use std::collections::HashMap;
use tokio::time::{Duration, Instant};

const FIRST_DELAY: Duration = Duration::from_secs(1);
const MAX_DELAY: Duration = Duration::from_secs(300);
const CAPACITY: usize = 4096;

struct Refusal {
    count: u32,
    retry_at: Instant,
}

/// Refused credentials by digest, bounded to `CAPACITY` entries.
#[derive(Default)]
pub(super) struct CredentialBackoff(HashMap<[u8; 32], Refusal>);

impl CredentialBackoff {
    /// Whether this credential must wait before storage is asked again.
    pub(super) fn waiting(&self, hash: &[u8; 32], now: Instant) -> bool {
        self.0
            .get(hash)
            .is_some_and(|refusal| now < refusal.retry_at)
    }

    /// Record a refusal and return how many this credential has had, or `None`
    /// when it goes untracked.
    ///
    /// When full of live entries, the new credential goes untracked rather than
    /// evicting one that is backing off: a flood of distinct credentials then
    /// costs one storage lookup each, which is what they cost without backoff.
    pub(super) fn refused(&mut self, hash: [u8; 32], now: Instant) -> Option<u32> {
        if self.0.len() >= CAPACITY && !self.0.contains_key(&hash) {
            self.0
                .retain(|_, refusal| now < refusal.retry_at + MAX_DELAY);
            if self.0.len() >= CAPACITY {
                return None;
            }
        }

        let refusal = self.0.entry(hash).or_insert(Refusal {
            count: 0,
            retry_at: now,
        });
        refusal.count = refusal.count.saturating_add(1);
        let doublings = (refusal.count - 1).min(16);
        refusal.retry_at = now + FIRST_DELAY.saturating_mul(1 << doublings).min(MAX_DELAY);
        Some(refusal.count)
    }
}

#[cfg(test)]
mod test;
