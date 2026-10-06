use std::{future::Future, pin::Pin, sync::Arc};

use calendar_events::domain::{
    models::{
        CalendarOccurrenceCursor, CalendarSyncStatus, OccurrenceListing, OccurrenceRange,
        VisibleCalendar,
    },
    ports::CalendarOccurrenceService,
};
use rootcause::Report;

pub(crate) type ReadFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, Report>> + Send + 'a>>;

/// Object-safe view of the calendar read service, so request data does not
/// carry the service's type parameters.
pub(crate) trait CalendarGraphqlReads: Send + Sync {
    fn list_occurrences(
        &self,
        viewer: String,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> ReadFuture<'_, Vec<OccurrenceListing>>;

    fn sync_status(&self, viewer: String) -> ReadFuture<'_, CalendarSyncStatus>;

    fn list_visible_calendars(&self, viewer: String) -> ReadFuture<'_, Vec<VisibleCalendar>>;
}

/// Type-erased calendar read service stored in GraphQL request data.
#[derive(Clone)]
pub struct CalendarGraphqlContext {
    pub(crate) reads: Arc<dyn CalendarGraphqlReads>,
}

impl CalendarGraphqlContext {
    /// Erase `service` so request data does not carry its type parameters.
    pub fn new<S: CalendarOccurrenceService>(service: Arc<S>) -> Self {
        Self {
            reads: Arc::new(OccurrenceServiceReads { service }),
        }
    }
}

struct OccurrenceServiceReads<S> {
    service: Arc<S>,
}

impl<S: CalendarOccurrenceService> CalendarGraphqlReads for OccurrenceServiceReads<S> {
    fn list_occurrences(
        &self,
        viewer: String,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> ReadFuture<'_, Vec<OccurrenceListing>> {
        Box::pin(async move {
            self.service
                .list_occurrences(&viewer, range, cursor, limit)
                .await
        })
    }

    fn sync_status(&self, viewer: String) -> ReadFuture<'_, CalendarSyncStatus> {
        Box::pin(async move { self.service.sync_status(&viewer).await })
    }

    fn list_visible_calendars(&self, viewer: String) -> ReadFuture<'_, Vec<VisibleCalendar>> {
        Box::pin(async move { self.service.list_visible_calendars(&viewer).await })
    }
}
