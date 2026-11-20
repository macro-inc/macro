//! How long a population waits before its mailbox tries it again.
//!
//! A waiting message stays in its mailbox's message group, so the wait holds
//! back that mailbox's other populations and nothing else.

use rand::Rng;
use std::time::Duration;

/// How a refused or failed population waits: the first wait, doubled per
/// try after the first, up to the longest.
pub(super) struct Backoff {
    first: Duration,
    longest: Duration,
}

/// The team's slots were all taken, as when operations pauses a team by
/// filling them. Up to an hour, so a paused mailbox's head message lasts
/// about three days of its queue's hundred deliveries, and comes back within
/// an hour of the pause ending.
pub(super) const TEAM_BUSY: Backoff = Backoff {
    first: Duration::from_secs(5),
    longest: Duration::from_secs(60 * 60),
};
/// A failed population, by its attempts.
pub(super) const FAILED: Backoff = Backoff {
    first: Duration::from_secs(30),
    longest: Duration::from_secs(15 * 60),
};

/// The wait after try `tries`, with equal jitter so populations refused
/// together come back spread out.
pub(super) fn wait(backoff: Backoff, tries: u32) -> Duration {
    let Backoff { first, longest } = backoff;
    let ceiling = 2u32
        .checked_pow(tries.saturating_sub(1))
        .and_then(|factor| first.checked_mul(factor))
        .map_or(longest, |ceiling| ceiling.min(longest));
    rand::rng()
        .random_range(ceiling / 2..=ceiling)
        .max(Duration::from_secs(1))
}
