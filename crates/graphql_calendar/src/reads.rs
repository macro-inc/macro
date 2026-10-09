use std::{future::Future, pin::Pin, sync::Arc};

use calendar_events::domain::{
    changes::{CalendarChangeQueryService, CalendarChangesPage, CalendarWatermark},
    models::{
        CalendarOccurrenceCursor, CalendarSyncStatus, OccurrenceListing, OccurrenceRange,
        VisibleCalendar,
    },
    ports::CalendarOccurrenceService,
};
use rootcause::Report;

pub(crate) type ReadFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, Report>> + Send + 'a>>;

/// Object-safe view of the calendar read services, so request data does not
/// carry their type parameters.
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

    fn current_watermark(&self, viewer: String) -> ReadFuture<'_, CalendarWatermark>;

    fn changes_since(
        &self,
        viewer: String,
        since: CalendarWatermark,
    ) -> ReadFuture<'_, CalendarChangesPage>;
}

/// Type-erased calendar read services stored in GraphQL request data.
#[derive(Clone)]
pub struct CalendarGraphqlContext {
    pub(crate) reads: Arc<dyn CalendarGraphqlReads>,
}

impl CalendarGraphqlContext {
    /// Erase the occurrence and change-log services so request data does not
    /// carry their type parameters.
    pub fn new<S, C>(occurrences: Arc<S>, changes: Arc<C>) -> Self
    where
        S: CalendarOccurrenceService,
        C: CalendarChangeQueryService,
    {
        Self {
            reads: Arc::new(ServiceReads {
                occurrences,
                changes,
            }),
        }
    }
}

struct ServiceReads<S, C> {
    occurrences: Arc<S>,
    changes: Arc<C>,
}

impl<S, C> CalendarGraphqlReads for ServiceReads<S, C>
where
    S: CalendarOccurrenceService,
    C: CalendarChangeQueryService,
{
    fn list_occurrences(
        &self,
        viewer: String,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> ReadFuture<'_, Vec<OccurrenceListing>> {
        Box::pin(async move {
            self.occurrences
                .list_occurrences(&viewer, range, cursor, limit)
                .await
        })
    }

    fn sync_status(&self, viewer: String) -> ReadFuture<'_, CalendarSyncStatus> {
        Box::pin(async move { self.occurrences.sync_status(&viewer).await })
    }

    fn list_visible_calendars(&self, viewer: String) -> ReadFuture<'_, Vec<VisibleCalendar>> {
        Box::pin(async move { self.occurrences.list_visible_calendars(&viewer).await })
    }

    fn current_watermark(&self, viewer: String) -> ReadFuture<'_, CalendarWatermark> {
        Box::pin(async move { self.changes.current_watermark(&viewer).await })
    }

    fn changes_since(
        &self,
        viewer: String,
        since: CalendarWatermark,
    ) -> ReadFuture<'_, CalendarChangesPage> {
        Box::pin(async move { self.changes.changes_since(&viewer, since).await })
    }
}
