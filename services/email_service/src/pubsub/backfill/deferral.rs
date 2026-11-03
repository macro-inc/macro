//! When rate-limited backfill work goes back to Gmail.
//!
//! A rate-limited operation is sent back to the backfill queue as a new
//! message instead of waiting out the visibility timeout. The request gate
//! refuses most of a large backfill's operations many times before they get
//! one of the mailbox's backfill slots, and each wait on the visibility
//! timeout would spend one of the queue's 20 deliveries. A refusal must never
//! cost a backfill its work.

use std::ops::RangeInclusive;
use std::time::Duration;

use email_api_client::domain::models::EmailApiError;
use models_email::email::service::pubsub::{DetailedError, FailureReason};
use rand::Rng;
use sqs_client::email::BACKFILL_DEFERRALS_ATTRIBUTE;

#[cfg(test)]
mod test;

/// Ceiling of the first deferral's delay; each later deferral doubles it.
const FIRST_DEFERRAL: Duration = Duration::from_secs(1);
/// Longest wait between attempts. A mailbox's deferred backlog then comes
/// back faster than its three backfill slots drain it, so slots don't sit
/// idle, while long-waiting work retries about once a minute.
const MAX_DEFERRAL: Duration = Duration::from_secs(60);
/// SQS's longest message delay, which bounds a provider's longer Retry-After.
const MAX_SQS_DELAY: Duration = Duration::from_secs(900);

/// The wait a refused operation was told to observe, when the failure is a
/// refusal: a Gmail rate limit (the request gate's or Gmail's Retry-After, if
/// either gave one) or no free backfill write slot.
pub(crate) fn rate_limit(error: &DetailedError) -> Option<Option<Duration>> {
    match error.reason {
        FailureReason::GmailApiRateLimited => {
            Some(match error.source.downcast_ref::<EmailApiError>() {
                Some(EmailApiError::RateLimited { retry_after, .. }) => *retry_after,
                _ => None,
            })
        }
        FailureReason::BackfillWritesBusy => Some(None),
        _ => None,
    }
}

/// How often the received operation has already been deferred.
pub(crate) fn deferrals(message: &aws_sdk_sqs::types::Message) -> u32 {
    message
        .message_attributes()
        .and_then(|attributes| attributes.get(BACKFILL_DEFERRALS_ATTRIBUTE))
        .and_then(|value| value.string_value())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

/// Whole seconds to hold an operation deferred `deferrals` times before.
pub(crate) fn delay_seconds(deferrals: u32, retry_after: Option<Duration>) -> i32 {
    delay(deferrals, retry_after, |range| {
        rand::rng().random_range(range)
    })
}

/// Exponential backoff with equal jitter, so operations refused together come
/// back spread out, and never sooner than the refusal's Retry-After.
fn delay(
    deferrals: u32,
    retry_after: Option<Duration>,
    jitter: impl FnOnce(RangeInclusive<Duration>) -> Duration,
) -> i32 {
    let ceiling = 2u32
        .checked_pow(deferrals)
        .and_then(|factor| FIRST_DEFERRAL.checked_mul(factor))
        .map_or(MAX_DEFERRAL, |ceiling| ceiling.min(MAX_DEFERRAL));
    let delay = jitter(ceiling / 2..=ceiling)
        .max(retry_after.unwrap_or_default())
        .min(MAX_SQS_DELAY);
    // SQS counts whole seconds; rounding down would retry before Retry-After.
    let seconds = delay.as_secs() + u64::from(delay.subsec_nanos() > 0);
    i32::try_from(seconds.max(1)).unwrap_or(i32::MAX)
}
