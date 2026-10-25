//! Adding a snapshot of a channel-shared event to the requester's own Google
//! calendar.
use super::*;
use crate::domain::{
    ics::{CalendarEventExport, CalendarEventExportAccess},
    join_requests::CalendarJoinRequestStatus,
    models::{CalendarProvider, EventType},
};

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    pub(super) async fn copy_into_calendar(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        let source = self
            .repository
            .event_export(requester_id, event_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)?;
        // A second projection under the same UID would shadow the one the
        // requester already has instead of adding anything.
        if source.access == CalendarEventExportAccess::OwnCopy {
            return Err(CalendarMutationError::AlreadyOnCalendar);
        }
        // The sharer's answer to a join request is an invitation to the
        // meeting under its own UID, which a snapshot added meanwhile would
        // take in, so a copy waits until the request is declined.
        let join_request = self
            .repository
            .find_join_request(event_id, requester_id)
            .await
            .map_err(internal)?;
        if join_request.is_some_and(|request| request.status != CalendarJoinRequestStatus::Declined)
        {
            return Err(CalendarMutationError::JoinRequestOpen);
        }
        // Google imports only regular events; status events such as
        // out-of-office belong to their owner's calendar alone.
        if source.event_type != EventType::Default {
            return Err(CalendarMutationError::InvalidInput(
                "only regular events can be added to a calendar".to_string(),
            ));
        }
        let target = self
            .repository
            .get_creation_target(requester_id, None, calendar_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NoWritableCalendar)?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        // Only Google imports an event under another meeting's UID, which is
        // what lets the copy stand in for the meeting once it syncs.
        if target.token_identity.provider != CalendarProvider::Google {
            return Err(CalendarMutationError::InvalidInput(
                "shared events can be added to Google calendars only".to_string(),
            ));
        }
        let (description, location) = source.without_macro_call();
        let source = CalendarEventExport {
            description,
            location,
            ..source
        };
        let access_token = self.fetch_token(&target.token_identity).await?;
        let outcome = self
            .provider
            .import_event(
                &access_token,
                &target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                &source,
            )
            .await
            .map_err(provider_error)?;
        match outcome {
            ProviderImportOutcome::Imported(upsert) => {
                self.persist_echo(target.actor.as_ref(), *upsert).await
            }
            ProviderImportOutcome::AlreadyHeld => {
                // Google already has the meeting on that calendar, most likely
                // an invitation Macro has not synced yet; pull it in so the
                // mention resolves to it.
                self.repository
                    .schedule_google_sync_for_link(target.email_link_id)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(
                            error = ?error,
                            email_link_id = %target.email_link_id,
                            "failed to schedule a sync for an already-held event"
                        );
                    })
                    .ok();
                Err(CalendarMutationError::AlreadyOnCalendar)
            }
            ProviderImportOutcome::Refused(error) => {
                tracing::warn!(
                    error = ?error,
                    calendar_id = %target.calendar_id,
                    "the provider refused to import a snapshot"
                );
                Err(CalendarMutationError::CopyRefused(error.to_string()))
            }
        }
    }
}

/// The span outcome of a copy.
pub(super) fn copy_outcome(result: &Result<CalendarEvent, CalendarMutationError>) -> &'static str {
    match result {
        Ok(_) => "copied",
        Err(CalendarMutationError::AlreadyOnCalendar) => "already_on_calendar",
        Err(CalendarMutationError::JoinRequestOpen) => "join_request_open",
        Err(CalendarMutationError::NotFound) => "not_found",
        Err(CalendarMutationError::NoWritableCalendar) => "no_writable_calendar",
        Err(CalendarMutationError::ReadOnly) => "read_only",
        Err(CalendarMutationError::InvalidInput(_)) => "invalid_input",
        Err(CalendarMutationError::CopyRefused(_)) => "copy_refused",
        Err(_) => "failed",
    }
}
