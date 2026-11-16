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

    /// Record a refusal and return how many this credential has had.
    ///
    /// When full of live entries, the new credential goes untracked rather than
    /// evicting one that is backing off: a flood of distinct credentials then
    /// costs one storage lookup each, which is what they cost without backoff.
    pub(super) fn refused(&mut self, hash: [u8; 32], now: Instant) -> u32 {
        if self.0.len() >= CAPACITY && !self.0.contains_key(&hash) {
            self.0
                .retain(|_, refusal| now < refusal.retry_at + MAX_DELAY);
            if self.0.len() >= CAPACITY {
                return 1;
            }
        }

        let refusal = self.0.entry(hash).or_insert(Refusal {
            count: 0,
            retry_at: now,
        });
        refusal.count = refusal.count.saturating_add(1);
        let doublings = (refusal.count - 1).min(16);
        refusal.retry_at = now + FIRST_DELAY.saturating_mul(1 << doublings).min(MAX_DELAY);
        refusal.count
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn delay_doubles_per_refusal_up_to_the_cap() {
        let mut backoff = CredentialBackoff::default();
        let start = Instant::now();
        let hash = [7; 32];
        assert!(!backoff.waiting(&hash, start));

        assert_eq!(backoff.refused(hash, start), 1);
        assert!(backoff.waiting(&hash, start + Duration::from_millis(999)));
        assert!(!backoff.waiting(&hash, start + Duration::from_secs(1)));

        let second = start + Duration::from_secs(1);
        assert_eq!(backoff.refused(hash, second), 2);
        assert!(backoff.waiting(&hash, second + Duration::from_millis(1999)));
        assert!(!backoff.waiting(&hash, second + Duration::from_secs(2)));

        let mut now = second;
        for _ in 0..20 {
            backoff.refused(hash, now);
        }
        now += Duration::from_secs(299);
        assert!(backoff.waiting(&hash, now));
        assert!(!backoff.waiting(&hash, now + Duration::from_secs(1)));
        assert!(!backoff.waiting(&[8; 32], now));
    }

    #[test]
    fn a_full_table_forgets_quiet_credentials_but_keeps_live_ones() {
        let mut backoff = CredentialBackoff::default();
        let start = Instant::now();
        for index in 0..CAPACITY {
            let mut hash = [0; 32];
            hash[..8].copy_from_slice(&(index as u64).to_le_bytes());
            backoff.refused(hash, start);
        }

        let newcomer = [0xff; 32];
        backoff.refused(newcomer, start);
        assert!(!backoff.waiting(&newcomer, start));

        let later = start + FIRST_DELAY + MAX_DELAY;
        backoff.refused(newcomer, later);
        assert!(backoff.waiting(&newcomer, later));
        assert_eq!(backoff.0.len(), 1);
    }
}
