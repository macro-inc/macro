use async_graphql::{Context, Object};
use calendar_events::domain::{models::CalendarOccurrenceCursor, service::CalendarValidationError};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::{
    CalendarGraphqlContext, bad_input,
    inputs::{CalendarRangeInput, encode_cursor},
    objects::{GraphqlCalendar, GraphqlCalendarOccurrence, GraphqlCalendarOccurrencePage},
    unavailable,
};

#[cfg(test)]
mod test;

/// Flattenable calendar fields of the authenticated user.
pub struct GraphqlCalendarQuery {
    user_id: MacroUserIdStr<'static>,
}

impl GraphqlCalendarQuery {
    /// Calendar fields scoped to the authenticated `user_id`. The read service
    /// is resolved from request data per field.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self { user_id }
    }

    fn viewer(&self) -> String {
        self.user_id.as_ref().to_owned()
    }
}

/// Calendar fields of the authenticated user.
#[Object]
impl GraphqlCalendarQuery {
    /// Every calendar visible across owned and delegated inboxes, primaries
    /// and writables first.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn calendars(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphqlCalendar>> {
        let reads = &ctx.data::<CalendarGraphqlContext>()?.reads;
        let calendars = reads
            .list_visible_calendars(self.viewer())
            .await
            .map_err(|error| unavailable(error, "calendars are unavailable"))?;
        Ok(calendars.into_iter().map(Into::into).collect())
    }

    /// One page of occurrences overlapping the viewport, across owned and
    /// delegated inboxes, ordered by start.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn calendar_occurrences(
        &self,
        ctx: &Context<'_>,
        input: CalendarRangeInput,
    ) -> async_graphql::Result<GraphqlCalendarOccurrencePage> {
        let reads = &ctx.data::<CalendarGraphqlContext>()?.reads;
        let request = input.into_page_request()?;
        let page_size = usize::from(request.page_size);
        let (mut rows, sync_status) = futures::try_join!(
            reads.list_occurrences(
                self.viewer(),
                request.range,
                request.cursor,
                request.page_size + 1,
            ),
            reads.sync_status(self.viewer()),
        )
        .map_err(occurrences_error)?;
        let has_next_page = rows.len() > page_size;
        rows.truncate(page_size);
        let end_cursor = has_next_page.then(|| rows.last()).flatten().map(|listing| {
            encode_cursor(CalendarOccurrenceCursor::from_occurrence(
                &listing.occurrence,
            ))
        });
        Ok(GraphqlCalendarOccurrencePage {
            nodes: rows
                .into_iter()
                .map(GraphqlCalendarOccurrence::from)
                .collect(),
            has_next_page,
            end_cursor,
            sync_status: sync_status.into(),
            watermark: Vec::new(),
        })
    }
}

fn occurrences_error(error: Report) -> async_graphql::Error {
    if error
        .downcast_current_context::<CalendarValidationError>()
        .is_some()
    {
        return bad_input(
            "calendar range must be positive, at most 370 days, and inside the maintained one-year-history/two-year-future window",
        );
    }
    unavailable(error, "calendar occurrences are unavailable")
}
