//! How long a population waits before its mailbox tries it again.
//!
//! A waiting message stays in its mailbox's message group, so the wait holds
//! back that mailbox's other populations and nothing else.

use rand::Rng;
use std::time::Duration;

/// First wait after the team's slots were all taken; it doubles per delivery.
pub(super) const TEAM_BUSY: Duration = Duration::from_secs(5);
/// First wait after a failed population; it doubles per failed attempt.
pub(super) const FAILED: Duration = Duration::from_secs(30);
/// Longest wait. A team paused through its slots for a day costs each of its
/// mailboxes about a hundred deliveries, the queue's redrive limit.
pub(super) const LONGEST: Duration = Duration::from_secs(900);

/// The wait after try `tries`: `first` doubled per try after the first,
/// capped at [`LONGEST`], with equal jitter so populations refused together
/// come back spread out.
pub(super) fn wait(first: Duration, tries: u32) -> Duration {
    let ceiling = 2u32
        .checked_pow(tries.saturating_sub(1))
        .and_then(|factor| first.checked_mul(factor))
        .map_or(LONGEST, |ceiling| ceiling.min(LONGEST));
    rand::rng()
        .random_range(ceiling / 2..=ceiling)
        .max(Duration::from_secs(1))
}
