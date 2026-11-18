//! A user's time zone is their primary calendar's.

use calendar_events::domain::ports::CalendarOccurrenceService;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::UserTimeZones;

/// [`UserTimeZones`] backed by the calendar read service.
pub struct PrimaryCalendarTimeZones<Calendars> {
    calendars: Calendars,
}

impl<Calendars> PrimaryCalendarTimeZones<Calendars> {
    /// Read time zones from `calendars`.
    pub const fn new(calendars: Calendars) -> Self {
        Self { calendars }
    }
}

impl<Calendars: CalendarOccurrenceService> UserTimeZones for PrimaryCalendarTimeZones<Calendars> {
    async fn time_zone(&self, user: &MacroUserIdStr<'static>) -> Option<String> {
        self.calendars
            .primary_time_zone(user.as_ref())
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, "failed to resolve a primary calendar time zone");
            })
            .ok()
            .flatten()
    }
}
