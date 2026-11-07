//! Implementation of [LastOnlineChecker] that delegates to [LastOnlineService].

use crate::domain::models::email_notification_digest::ports::LastOnlineChecker;
use last_online_tracker::domain::{ports::LastOnlineRepo, services::LastOnlineService};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::time::Duration;

/// Adapter that implements [LastOnlineChecker] by delegating to [LastOnlineService].
///
/// When a user has never been tracked (i.e., `time_since_last_online` returns `None`),
/// this adapter returns [Duration::MAX] to indicate the user has been offline "forever",
/// which ensures they qualify for batch email digest delivery.
pub struct LastOnlineCheckerImpl<T, R> {
    service: LastOnlineService<T, R>,
}

impl<T, R> LastOnlineCheckerImpl<T, R> {
    /// Create a new [LastOnlineCheckerImpl] wrapping the given [LastOnlineService].
    pub fn new(service: LastOnlineService<T, R>) -> Self {
        Self { service }
    }
}

impl<T, R> LastOnlineChecker for LastOnlineCheckerImpl<T, R>
where
    T: last_online_tracker::domain::ports::SystemTime,
    R: LastOnlineRepo,
{
    async fn last_online_checker<'a>(&self, user: MacroUserIdStr<'a>) -> Result<Duration, Report> {
        let duration = self.service.time_since_last_online(user).await?;
        Ok(duration.unwrap_or(Duration::MAX))
    }
}
