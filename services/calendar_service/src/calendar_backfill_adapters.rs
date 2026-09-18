//! Process-level adapters backing the calendar application services.

use calendar_events::domain::ports::{GoogleProviderError, GoogleProviderErrorKind};
use calendar_events::outbound::google::GoogleRequestGate;
use uuid::Uuid;

use crate::calendar_ratelimit::CalendarRateLimiter;

/// Enforces the per-inbox Google Calendar API quota before each request.
#[derive(Clone)]
pub struct RedisCalendarRequestGate {
    limiter: CalendarRateLimiter,
}

impl RedisCalendarRequestGate {
    /// Construct the gate over the process-level Redis rate limiter.
    pub fn new(limiter: CalendarRateLimiter) -> Self {
        Self { limiter }
    }
}

impl GoogleRequestGate for RedisCalendarRequestGate {
    async fn acquire(&self, email_link_id: Uuid) -> Result<(), GoogleProviderError> {
        if self.limiter.is_calendar_rate_limited(email_link_id).await {
            return Err(GoogleProviderError::new(
                GoogleProviderErrorKind::Transient,
                "Google Calendar API rate limit reached for this inbox",
            ));
        }
        Ok(())
    }
}
