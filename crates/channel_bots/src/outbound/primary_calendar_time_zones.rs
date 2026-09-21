//! Calendar-backed time zone lookup for channel bot prompts.

use std::sync::Arc;

use async_trait::async_trait;
use calendar_events::domain::ports::CalendarOccurrenceService;

use crate::domain::ports::UserTimeZones;

/// [`UserTimeZones`] backed by the calendar read service: a user's time zone
/// is their primary calendar's.
pub struct PrimaryCalendarTimeZones<O> {
    calendars: Arc<O>,
}

impl<O> PrimaryCalendarTimeZones<O> {
    /// Create the lookup from the calendar occurrence read service.
    pub fn new(calendars: Arc<O>) -> Self {
        Self { calendars }
    }
}

#[async_trait]
impl<O> UserTimeZones for PrimaryCalendarTimeZones<O>
where
    O: CalendarOccurrenceService,
{
    async fn primary_time_zone(&self, user_id: &str) -> Option<String> {
        self.calendars
            .primary_time_zone(user_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, "failed to resolve a primary calendar time zone");
            })
            .ok()
            .flatten()
    }
}
