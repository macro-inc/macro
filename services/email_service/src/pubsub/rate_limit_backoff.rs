//! When a rate-limited Gmail operation goes back to Gmail.

use rand::Rng;
use std::ops::RangeInclusive;
use std::time::Duration;

#[cfg(test)]
mod test;

/// Longest delay before the first retry; each later retry doubles it.
const BASE_BACKOFF: Duration = Duration::from_secs(30);
/// Longest delay before any retry, so an operation lands within minutes of
/// Gmail accepting requests again.
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// The longest SQS holds a message back (`DelaySeconds`). A longer Retry-After
/// is cut to this; the next attempt is refused and waits again.
const MAX_DELAY: Duration = Duration::from_secs(900);

/// How long to hold a rate-limited operation before its next attempt.
///
/// The primary queue hands an operation to the retry queue on its first rate
/// limit, so a retry queue delivery received `n` times precedes retry `n + 1`.
pub(crate) fn next_retry_delay(
    retry_worker: bool,
    receive_count: u32,
    retry_after: Option<Duration>,
) -> Duration {
    let retry = if retry_worker {
        receive_count.saturating_add(1)
    } else {
        1
    };
    retry_delay(retry, retry_after, |range| rand::rng().random_range(range))
}

/// Exponential backoff with equal jitter: at least half of `retry`'s ceiling
/// (1 for the first retry), so operations rate-limited together come back
/// spread out. Never shorter than the provider's Retry-After.
fn retry_delay(
    retry: u32,
    retry_after: Option<Duration>,
    jitter: impl FnOnce(RangeInclusive<Duration>) -> Duration,
) -> Duration {
    let ceiling = 2u32
        .checked_pow(retry.saturating_sub(1))
        .and_then(|factor| BASE_BACKOFF.checked_mul(factor))
        .map_or(MAX_BACKOFF, |backoff| backoff.min(MAX_BACKOFF));
    jitter(ceiling / 2..=ceiling)
        .max(retry_after.unwrap_or_default())
        .min(MAX_DELAY)
}
