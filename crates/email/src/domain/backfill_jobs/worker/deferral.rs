//! When refused or failed backfill work is tried again.
//!
//! A rate-limited operation is sent back to the backfill queue as a new
//! message instead of waiting out the visibility timeout. The request gate
//! refuses most of a large backfill's operations many times before they get
//! one of the mailbox's backfill slots, and each wait on the visibility
//! timeout would spend one of the queue's 20 deliveries. A refusal must never
//! cost a backfill its work.
//!
//! Any other retryable failure stays on its delivery and is hidden for a
//! growing delay ([`redelivery_delay_seconds`]), so an operation that keeps
//! failing spends its 20 deliveries over hours instead of minutes and takes
//! little of the shared queue's throughput while it does.

use std::ops::RangeInclusive;
use std::time::Duration;

use email_api_client::domain::models::EmailApiError;
use models_email::email::service::pubsub::{DetailedError, FailureReason};
use rand::Rng;

#[cfg(test)]
mod test;

/// How the wait between attempts grows: the first attempt's ceiling doubles
/// with each attempt up to the longest wait.
struct Backoff {
    first: Duration,
    max: Duration,
}

/// Gmail and write-slot refusals. A mailbox's deferred backlog then comes back
/// faster than its three backfill slots drain it, so slots don't sit idle,
/// while long-waiting work retries about once a minute.
const REFUSAL: Backoff = Backoff {
    first: Duration::from_secs(1),
    max: Duration::from_secs(60),
};
/// A team's CRM population slots are held by the rest of that team's backlog,
/// which drains at the speed of its slowest populations. Waiting up to SQS's
/// longest delay keeps a team with tens of thousands of populations from
/// cycling them through the shared queue every minute.
const CRM_POPULATION_REFUSAL: Backoff = Backoff {
    first: Duration::from_secs(5),
    max: MAX_SQS_DELAY,
};
/// A failed delivery left for redelivery. The first retry comes about as soon
/// as the queue's visibility timeout would have allowed.
const REDELIVERY: Backoff = Backoff {
    first: Duration::from_secs(30),
    max: Duration::from_secs(900),
};
/// SQS's longest message delay, which bounds a provider's longer Retry-After.
const MAX_SQS_DELAY: Duration = Duration::from_secs(900);

/// The wait a refused operation was told to observe, when the failure is a
/// refusal: a Gmail rate limit (the request gate's or Gmail's Retry-After, if
/// either gave one), no free backfill write slot, or no free CRM population
/// slot for the team.
pub fn rate_limit(error: &DetailedError) -> Option<Option<Duration>> {
    match error.reason {
        FailureReason::GmailApiRateLimited => {
            Some(match error.source.downcast_ref::<EmailApiError>() {
                Some(EmailApiError::RateLimited { retry_after, .. }) => *retry_after,
                _ => None,
            })
        }
        FailureReason::BackfillWritesBusy | FailureReason::CrmPopulationBusy => Some(None),
        _ => None,
    }
}

/// Whole seconds to hold an operation refused for `reason`, deferred
/// `deferrals` times before.
pub(crate) fn delay_seconds(
    reason: FailureReason,
    deferrals: u32,
    retry_after: Option<Duration>,
) -> i32 {
    delay(refusal_backoff(reason), deferrals, retry_after, |range| {
        rand::rng().random_range(range)
    })
}

/// Whole seconds to hide a delivery whose operation failed and will be retried,
/// given how many times SQS has delivered it (the first delivery is 1).
pub fn redelivery_delay_seconds(receives: u32) -> i32 {
    delay(&REDELIVERY, receives.saturating_sub(1), None, |range| {
        rand::rng().random_range(range)
    })
}

fn refusal_backoff(reason: FailureReason) -> &'static Backoff {
    match reason {
        FailureReason::CrmPopulationBusy => &CRM_POPULATION_REFUSAL,
        _ => &REFUSAL,
    }
}

/// Exponential backoff with equal jitter, so operations refused together come
/// back spread out, and never sooner than the refusal's Retry-After.
fn delay(
    backoff: &Backoff,
    attempts: u32,
    retry_after: Option<Duration>,
    jitter: impl FnOnce(RangeInclusive<Duration>) -> Duration,
) -> i32 {
    let ceiling = 2u32
        .checked_pow(attempts)
        .and_then(|factor| backoff.first.checked_mul(factor))
        .map_or(backoff.max, |ceiling| ceiling.min(backoff.max));
    let delay = jitter(ceiling / 2..=ceiling)
        .max(retry_after.unwrap_or_default())
        .min(MAX_SQS_DELAY);
    // SQS counts whole seconds; rounding down would retry before Retry-After.
    let seconds = delay.as_secs() + u64::from(delay.subsec_nanos() > 0);
    i32::try_from(seconds.max(1)).unwrap_or(i32::MAX)
}
