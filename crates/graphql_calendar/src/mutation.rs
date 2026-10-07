use async_graphql::{Context, ErrorExtensions, Object};
use calendar_events::domain::{changes::CalendarEventChange, ports::CalendarMutationError};
use graphql_common::require_authenticated_user;
use uuid::Uuid;

use crate::{
    objects::GraphqlCalendarMutationPayload,
    writes::{CalendarGraphqlMutationContext, CalendarGraphqlWrites},
};

mod inputs;
#[cfg(test)]
mod test;

pub use inputs::{
    AllDayEventTimeInput, CalendarEventTimeInput, CalendarOutOfOfficeInput,
    CalendarReminderOverrideInput, CalendarRemindersInput, CreateCalendarEventInput,
    DeleteCalendarEventInput, GraphqlCalendarAttendeeInput, GraphqlCalendarConferenceChange,
    GraphqlCalendarDeletionScope, GraphqlCalendarOutOfOfficeAutoDeclineMode,
    GraphqlCalendarRsvpScope, GraphqlCalendarUpdateScope, RespondToCalendarEventInput,
    TimedEventTimeInput, UpdateCalendarEventInput,
};

/// Calendar event mutations. Each answers with the event's committed state:
/// the series event and every visible occurrence, or the id of an event the
/// write removed.
#[derive(Default)]
pub struct CalendarMutationRoot;

#[Object]
impl CalendarMutationRoot {
    /// Create an event on one of the viewer's writable calendars.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn create_calendar_event(
        &self,
        ctx: &Context<'_>,
        input: CreateCalendarEventInput,
    ) -> async_graphql::Result<GraphqlCalendarMutationPayload> {
        let viewer = require_authenticated_user(ctx)?.as_ref().to_owned();
        let writes = &ctx.data::<CalendarGraphqlMutationContext>()?.writes;
        let request = input.into_request().map_err(invalid_input)?;
        let event = writes
            .create_event(
                viewer.clone(),
                request.email_link_id,
                request.calendar_id,
                request.draft,
            )
            .await
            .map_err(mutation_error)?;
        committed_state(writes.as_ref(), viewer, event.id, None).await
    }

    /// Patch an event, the whole series or one occurrence.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn update_calendar_event(
        &self,
        ctx: &Context<'_>,
        input: UpdateCalendarEventInput,
    ) -> async_graphql::Result<GraphqlCalendarMutationPayload> {
        let viewer = require_authenticated_user(ctx)?.as_ref().to_owned();
        let writes = &ctx.data::<CalendarGraphqlMutationContext>()?.writes;
        let request = input.into_request().map_err(invalid_input)?;
        let before = state_before(writes.as_ref(), viewer.clone(), request.event_id).await;
        writes
            .update_event(
                viewer.clone(),
                request.event_id,
                request.calendar_id,
                request.patch,
                request.scope,
            )
            .await
            .map_err(mutation_error)?;
        committed_state(writes.as_ref(), viewer, request.event_id, before).await
    }

    /// Delete an event, one occurrence, or an occurrence onward.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn delete_calendar_event(
        &self,
        ctx: &Context<'_>,
        input: DeleteCalendarEventInput,
    ) -> async_graphql::Result<GraphqlCalendarMutationPayload> {
        let viewer = require_authenticated_user(ctx)?.as_ref().to_owned();
        let writes = &ctx.data::<CalendarGraphqlMutationContext>()?.writes;
        let request = input.into_request().map_err(invalid_input)?;
        let before = state_before(writes.as_ref(), viewer.clone(), request.event_id).await;
        writes
            .delete_event(
                viewer.clone(),
                request.event_id,
                request.calendar_id,
                request.scope,
            )
            .await
            .map_err(mutation_error)?;
        committed_state(writes.as_ref(), viewer, request.event_id, before).await
    }

    /// Set the viewer's RSVP on an event, the whole series or one occurrence.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn respond_to_calendar_event(
        &self,
        ctx: &Context<'_>,
        input: RespondToCalendarEventInput,
    ) -> async_graphql::Result<GraphqlCalendarMutationPayload> {
        let viewer = require_authenticated_user(ctx)?.as_ref().to_owned();
        let writes = &ctx.data::<CalendarGraphqlMutationContext>()?.writes;
        let request = input.into_request().map_err(invalid_input)?;
        let before = state_before(writes.as_ref(), viewer.clone(), request.event_id).await;
        writes
            .respond_to_event(
                viewer.clone(),
                request.event_id,
                request.calendar_id,
                request.response,
                request.scope,
                request.responding_email,
            )
            .await
            .map_err(mutation_error)?;
        committed_state(writes.as_ref(), viewer, request.event_id, before).await
    }
}

/// The event as it stood before a write, so the answer can name the
/// occurrences the write removed. Best effort: without it the answer still
/// carries the committed state, and the change log removes the rest.
async fn state_before(
    writes: &dyn CalendarGraphqlWrites,
    viewer: String,
    event_id: Uuid,
) -> Option<CalendarEventChange> {
    writes
        .event_change(viewer, event_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(error = ?error, %event_id, "failed to read a calendar event before writing it");
        })
        .ok()
        .flatten()
}

/// Read the event back from the primary database once the write committed.
/// A failed read after a successful write is reported like a lagging
/// persistence: the change is at the provider and the next sync shows it.
async fn committed_state(
    writes: &dyn CalendarGraphqlWrites,
    viewer: String,
    event_id: Uuid,
    before: Option<CalendarEventChange>,
) -> async_graphql::Result<GraphqlCalendarMutationPayload> {
    let after = writes
        .event_change(viewer, event_id)
        .await
        .map_err(|error| {
            mutation_error(CalendarMutationError::PersistFailed(format!("{error:?}")))
        })?;
    Ok(GraphqlCalendarMutationPayload::new(event_id, before, after))
}

/// Map a mutation failure to the REST error's message and snake_case `code`.
/// `retryable` marks the failures a client may retry unchanged; provider and
/// infrastructure details stay in the logs.
pub(crate) fn mutation_error(error: CalendarMutationError) -> async_graphql::Error {
    let (code, message): (&str, String) = match &error {
        CalendarMutationError::NotFound => ("not_found", "calendar event was not found".into()),
        CalendarMutationError::OccurrenceNotFound => (
            "occurrence_not_found",
            "the targeted occurrence was not found on the recurring event; the calendar was \
             out of date and has been refreshed"
                .into(),
        ),
        CalendarMutationError::ReadOnly => ("read_only", "this calendar is read-only".into()),
        CalendarMutationError::NoWritableCalendar => (
            "no_writable_calendar",
            "no connected calendar can accept new events".into(),
        ),
        CalendarMutationError::NotAttendee => (
            "not_attendee",
            "the connected account is not an attendee of this event".into(),
        ),
        CalendarMutationError::InvalidInput(message) => ("invalid_input", message.clone()),
        CalendarMutationError::ReauthRequired(_) => (
            "reauth_required",
            "calendar access must be re-authorized".into(),
        ),
        CalendarMutationError::ProviderRejected(message) => ("provider_rejected", message.clone()),
        CalendarMutationError::Retryable(_) => (
            "retryable",
            "the calendar mutation failed transiently; try again".into(),
        ),
        CalendarMutationError::PersistFailed(_) => (
            "persist_failed",
            "the change reached the calendar provider; refresh to see it".into(),
        ),
    };
    let retryable = matches!(error, CalendarMutationError::Retryable(_));
    if matches!(
        error,
        CalendarMutationError::Retryable(_) | CalendarMutationError::PersistFailed(_)
    ) {
        tracing::error!(error = ?error, "calendar mutation failed");
    }
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
        extensions.set("retryable", retryable);
    })
}

/// Tag a malformed input with the same `invalid_input` code the calendar
/// service reports for invalid fields.
fn invalid_input(error: async_graphql::Error) -> async_graphql::Error {
    error.extend_with(|_, extensions| {
        extensions.set("code", "invalid_input");
        extensions.set("retryable", false);
    })
}
