//! [`SendAllowance`] over the shared rate limiter.

#[cfg(test)]
mod test;

use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::{RateBudgetPort, RateLimitConfig, RateLimitKey, RateLimitPort};

use crate::ping::{AllowanceExceeded, SendAllowance};

/// Notifications each sender may send per [`WINDOW`], counted per recipient.
/// Far above ordinary use: it stops a program stuck in a loop and nothing
/// else.
pub(crate) const NOTIFICATIONS_PER_WINDOW: u64 = 1000;

/// Notifications one person receives from others per [`WINDOW`], from every
/// sender together, so no group of senders can flood someone's phone. Pings
/// to oneself are not counted, so others cannot use up what a person's own
/// routines and agents report back through.
pub(crate) const RECEIVES_PER_WINDOW: u64 = 60;

pub(crate) const WINDOW: Duration = Duration::from_secs(60 * 60);

/// What the senders' counters are filed under, beside the sender.
const KEY_SCOPE: &str = "ping-recipients";

/// What the recipients' counters are filed under, beside the recipient.
const RECEIVED_KEY_SCOPE: &str = "ping-recipient";

fn received_key(recipient: &MacroUserIdStr<'_>) -> RateLimitKey {
    RateLimitKey::builder(&RECEIVED_KEY_SCOPE)
        .append(&recipient.as_ref())
        .finish()
}

/// Keeps each sender's and recipient's count for the current hour in the rate
/// limiter's store.
pub(crate) struct HourlyAllowance<Budget>(pub Budget);

impl<Budget: RateBudgetPort + RateLimitPort> SendAllowance for HourlyAllowance<Budget> {
    async fn take(
        &self,
        sender: &MacroUserIdStr<'_>,
        notifications: u64,
    ) -> Result<Result<(), AllowanceExceeded>, rootcause::Report> {
        let key = RateLimitKey::builder(&KEY_SCOPE)
            .append(&sender.as_ref())
            .finish();
        let spent = self
            .0
            .spend(
                key,
                RateLimitConfig::new(NOTIFICATIONS_PER_WINDOW, WINDOW),
                notifications,
            )
            .await?;
        Ok(spent.map(|_| ()).map_err(|exceeded| AllowanceExceeded {
            limit: exceeded.max_count,
            retry_after: exceeded.retry_after,
        }))
    }

    async fn take_received(
        &self,
        recipient: &MacroUserIdStr<'_>,
    ) -> Result<bool, rootcause::Report> {
        let counted = self
            .0
            .check(
                received_key(recipient),
                RateLimitConfig::new(RECEIVES_PER_WINDOW, WINDOW),
            )
            .await?;
        Ok(counted.is_ok())
    }

    async fn give_back_received(
        &self,
        recipient: &MacroUserIdStr<'_>,
    ) -> Result<(), rootcause::Report> {
        self.0.decrement(&received_key(recipient)).await
    }
}
