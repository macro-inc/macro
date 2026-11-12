//! Owner-only removal of an inbox's calendar capability.

use super::catalog::{InboxAccess, InboxAccessError, InboxAccessRepository, InboxCatalogService};
use calendar_events::domain::ports::CalendarMutationError;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Calendar-domain removal for one owned inbox.
pub trait InboxCalendar: Send + Sync + 'static {
    /// Remove calendar data and disable its grant capability.
    fn disconnect(
        &self,
        caller: &str,
        link: Uuid,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;
}

/// Calendar removal failed before or during the calendar-domain mutation.
#[derive(Debug, thiserror::Error)]
pub enum InboxCalendarError<E> {
    /// The caller cannot access or does not own the inbox.
    #[error(transparent)]
    Access(#[from] InboxAccessError<E>),
    /// The calendar-domain mutation failed.
    #[error("failed to disconnect the inbox calendar: {0:?}")]
    Mutation(CalendarMutationError),
}

/// Authorizes and removes the calendar belonging to one connected inbox.
pub struct CalendarDisconnectService<R, C> {
    /// Resolves ownership and delegation through the shared inbox catalog.
    pub catalog: Arc<InboxCatalogService<R>>,
    /// Performs the calendar-domain mutation after authorization.
    pub calendar: C,
}

impl<R: InboxAccessRepository, C: InboxCalendar> CalendarDisconnectService<R, C> {
    /// Only an owner may disable an inbox's calendar; delegates remain read-only here.
    pub async fn disconnect(
        &self,
        caller: &str,
        link: Uuid,
    ) -> Result<(), InboxCalendarError<R::Err>> {
        let (_, access) = self.catalog.authorize(caller, link).await?;
        if access == InboxAccess::Delegated {
            return Err(InboxAccessError::Forbidden.into());
        }
        self.calendar
            .disconnect(caller, link)
            .await
            .map_err(|error| match error {
                CalendarMutationError::NotFound => InboxAccessError::NotFound.into(),
                error => InboxCalendarError::Mutation(error),
            })
    }
}
