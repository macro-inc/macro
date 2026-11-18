//! Delegates authorized inbox calendar removal to the calendar domain.

use calendar_events::domain::ports::{CalendarMutationError, CalendarMutationService};
use email::domain::mailbox::calendar_disconnect::InboxCalendar;
use std::sync::Arc;
use uuid::Uuid;

pub struct CalendarDisconnect<C>(pub Arc<C>);

impl<C: CalendarMutationService> InboxCalendar for CalendarDisconnect<C> {
    async fn disconnect(&self, caller: &str, link: Uuid) -> Result<(), CalendarMutationError> {
        self.0.disconnect_calendar(caller, link).await
    }
}
