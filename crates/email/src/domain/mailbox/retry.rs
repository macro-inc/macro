//! How a failed message read, or projection event, is retried: backoff,
//! the delays a provider asks for, and when to give up.

use super::{MailboxError, MessageRetry};
use email_api_client::domain::models::EmailApiError;

#[cfg(test)]
mod test;

/// Claims after which a message the provider keeps refusing outright
/// (malformed, forbidden), or whose data the database refuses, is abandoned:
/// 3 tries, 10 minutes apart.
pub(super) const PERMANENT_FAILURE_ATTEMPTS: i32 = 3;

/// Claims after which a message that keeps failing for any other reason of
/// its own is abandoned. With the backoff below that is about a day.
pub(super) const MESSAGE_FAILURE_ATTEMPTS: i32 = 50;

/// The longest backoff. The `outlook-message-parked-too-long` monitor alerts
/// above 30 minutes, which only a Graph `Retry-After` should reach.
pub(super) const MAX_BACKOFF_SECONDS: u32 = 1800;

/// How a failed reconciliation, or projection event, is retried. `attempts`
/// counts this claim.
/// Throttling and credential failures belong to the mailbox, not the message,
/// so they keep their own delays and never move it closer to abandonment.
/// A transient provider failure (Graph 5xx or 408, a request Graph never
/// answered) says nothing about the message either: during an outage every
/// message gets one. It backs off like any failure but is never abandoned, and
/// stops counting once the backoff is at its longest. A lock the database
/// could not grant in time is the same: another transaction held the
/// mailbox's rows, which says nothing about the message. Data the database
/// refuses is refused the same way again, so it stops as an outright refusal
/// does; the few tries let a refusal that briefly hit valid data (a deploy
/// in progress) clear.
pub(super) fn message_retry(error: &MailboxError, attempts: i32) -> MessageRetry {
    match error {
        MailboxError::Provider(
            error @ (EmailApiError::RateLimited { .. }
            | EmailApiError::CredentialsUnavailable { .. }
            | EmailApiError::AuthRequired),
        ) => MessageRetry::After {
            seconds: retry_seconds(error),
            counted: false,
        },
        MailboxError::Provider(EmailApiError::Permanent { .. } | EmailApiError::Forbidden)
        | MailboxError::Unstorable(_) => {
            if attempts >= PERMANENT_FAILURE_ATTEMPTS {
                MessageRetry::Abandon
            } else {
                MessageRetry::After {
                    seconds: 600,
                    counted: true,
                }
            }
        }
        _ if error.is_lock_timeout()
            || matches!(
                error,
                MailboxError::Provider(EmailApiError::Transient { .. })
            ) =>
        {
            let seconds = backoff_seconds(attempts);
            MessageRetry::After {
                seconds,
                counted: seconds < MAX_BACKOFF_SECONDS,
            }
        }
        MailboxError::Stale => MessageRetry::After {
            seconds: 30,
            counted: true,
        },
        _ if attempts >= MESSAGE_FAILURE_ATTEMPTS => MessageRetry::Abandon,
        _ => MessageRetry::After {
            seconds: backoff_seconds(attempts),
            counted: true,
        },
    }
}

/// 30 s doubling to 30 minutes: 30, 60, 120, ... 960, then 1800.
fn backoff_seconds(attempts: i32) -> u32 {
    (30_u32 << attempts.clamp(1, 7).saturating_sub(1)).min(MAX_BACKOFF_SECONDS)
}

pub(super) fn retry_seconds(error: &EmailApiError) -> u32 {
    match error {
        EmailApiError::RateLimited {
            retry_after: Some(delay),
            ..
        } => delay.as_secs().clamp(1, 86_400) as u32,
        EmailApiError::AuthRequired | EmailApiError::Forbidden => 300,
        EmailApiError::Permanent { .. } => 600,
        _ => 30,
    }
}
