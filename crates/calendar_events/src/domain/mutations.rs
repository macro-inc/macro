//! User-initiated calendar mutation policy.
//!
//! Mutations write through to the provider first — Google stays the write
//! authority, exactly as ingestion assumes — and then persist the provider's
//! normalized echo through the same upsert path sync uses, so the local
//! projection is read-your-writes fresh and the next incremental sync
//! no-ops on the idempotency short-circuit.

use chrono::Utc;
use uuid::Uuid;

use super::{
    models::{
        AttendeeResponseStatus, CalendarEvent, CalendarEventDraft, CalendarEventMutationTarget,
        CalendarEventPatch, CalendarEventUpsert, EventTime, OccurrenceRange,
    },
    ports::{
        CalendarAccessTokenProvider, CalendarDeletionScope, CalendarEventWrite,
        CalendarMutationError, CalendarMutationService, CalendarRepository, CalendarRsvpScope,
        CalendarTokenError, GoogleCalendarMutationProvider, GoogleProviderError,
        GoogleProviderErrorKind, GoogleRsvpOutcome, GoogleSeriesMutationOutcome,
    },
};

/// Calendar mutation use cases with provider, token, and persistence
/// details behind ports.
pub struct CalendarMutationServiceImpl<R, G, T> {
    repository: R,
    provider: G,
    tokens: T,
}

impl<R, G, T> CalendarMutationServiceImpl<R, G, T>
where
    R: CalendarRepository,
    G: GoogleCalendarMutationProvider,
    T: CalendarAccessTokenProvider,
{
    /// Construct the service from its ports.
    pub fn new(repository: R, provider: G, tokens: T) -> Self {
        Self {
            repository,
            provider,
            tokens,
        }
    }

    async fn resolve_mutation_target(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> Result<CalendarEventMutationTarget, CalendarMutationError> {
        self.repository
            .get_event_mutation_target(requester_id, event_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)
    }

    async fn fetch_token(
        &self,
        target_identity: &super::models::CalendarLinkTokenIdentity,
    ) -> Result<String, CalendarMutationError> {
        self.tokens
            .fetch_access_token(target_identity)
            .await
            .map_err(|error| match error {
                CalendarTokenError::ReauthRequired(message) => {
                    CalendarMutationError::ReauthRequired(message)
                }
                CalendarTokenError::Transient(message) => CalendarMutationError::Retryable(message),
            })
    }

    /// Persist the provider echo and return the canonical event with its
    /// applied entity id.
    async fn persist_echo(
        &self,
        upsert: CalendarEventUpsert,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        let mut event = upsert.event.clone();
        let event_id = self
            .repository
            .upsert_event(CalendarEventWrite::UserMutation(upsert))
            .await
            .map_err(|error| CalendarMutationError::PersistFailed(format!("{error:?}")))?;
        event.id = event_id;
        Ok(event)
    }
}

impl<R, G, T> CalendarMutationService for CalendarMutationServiceImpl<R, G, T>
where
    R: CalendarRepository,
    G: GoogleCalendarMutationProvider,
    T: CalendarAccessTokenProvider,
{
    #[tracing::instrument(skip(self, requester_id, draft), err)]
    async fn create_event(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        validate_time(&draft.time)?;
        validate_attendee_emails(draft.attendees.iter().map(|attendee| &attendee.email))?;
        let target = self
            .repository
            .get_creation_target(requester_id, email_link_id, calendar_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NoWritableCalendar)?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        let access_token = self.fetch_token(&target.token_identity).await?;
        let upsert = self
            .provider
            .create_event(
                &access_token,
                &target.google_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                &draft,
            )
            .await
            .map_err(provider_error)?;
        self.persist_echo(upsert).await
    }

    #[tracing::instrument(skip(self, requester_id, patch), err)]
    async fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        patch: CalendarEventPatch,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        if patch.is_empty() {
            return Err(CalendarMutationError::InvalidInput(
                "the patch changes nothing".to_string(),
            ));
        }
        if let Some(time) = &patch.time {
            validate_time(time)?;
        }
        if let Some(attendees) = &patch.attendees {
            validate_attendee_emails(attendees.iter().map(|attendee| &attendee.email))?;
        }
        let target = self.resolve_mutation_target(requester_id, event_id).await?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        let access_token = self.fetch_token(&target.token_identity).await?;
        let updated = self
            .provider
            .update_event(
                &access_token,
                &target.google_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
                &patch,
            )
            .await
            .map_err(provider_error)?;
        let Some(upsert) = updated else {
            // The provider no longer has the event; retire the stale local
            // source the same way a feed tombstone would.
            self.retire_gone_source(&target).await;
            return Err(CalendarMutationError::NotFound);
        };
        self.persist_echo(upsert).await
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        let target = self.resolve_mutation_target(requester_id, event_id).await?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        let access_token = self.fetch_token(&target.token_identity).await?;
        let google_target = target.google_target(OccurrenceRange::maintenance_horizon(Utc::now()));
        let outcome = match &scope {
            CalendarDeletionScope::All => {
                self.provider
                    .delete_event(
                        &access_token,
                        &google_target,
                        target.master_provider_event_id(),
                    )
                    .await
                    .map_err(provider_error)?;
                GoogleSeriesMutationOutcome::SeriesDeleted
            }
            CalendarDeletionScope::ThisEvent { recurrence_id } => self
                .provider
                .delete_event_instance(
                    &access_token,
                    &google_target,
                    target.master_provider_event_id(),
                    recurrence_id,
                )
                .await
                .map_err(provider_error)?,
            CalendarDeletionScope::ThisAndFollowing { recurrence_id } => self
                .provider
                .truncate_recurring_event(
                    &access_token,
                    &google_target,
                    target.master_provider_event_id(),
                    recurrence_id,
                )
                .await
                .map_err(provider_error)?,
        };
        match outcome {
            GoogleSeriesMutationOutcome::Applied(upsert) => {
                self.persist_echo(*upsert).await.map(|_| ())
            }
            // Either the deletion removed the series or it was already
            // gone; retiring the local source converges both.
            GoogleSeriesMutationOutcome::SeriesDeleted | GoogleSeriesMutationOutcome::Gone => self
                .repository
                .remove_google_source(
                    target.account_id,
                    target.calendar_id,
                    target.master_provider_event_id(),
                )
                .await
                .map_err(|error| CalendarMutationError::PersistFailed(format!("{error:?}"))),
        }
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn respond_to_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        let target = self.resolve_mutation_target(requester_id, event_id).await?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        let access_token = self.fetch_token(&target.token_identity).await?;
        let outcome = self
            .provider
            .rsvp_event(
                &access_token,
                &target.google_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
                &target.token_identity.email_address,
                response,
                &scope,
            )
            .await
            .map_err(provider_error)?;
        match outcome {
            GoogleRsvpOutcome::Applied(upsert) => self.persist_echo(*upsert).await,
            GoogleRsvpOutcome::NotAttendee => Err(CalendarMutationError::NotAttendee),
            GoogleRsvpOutcome::Gone => {
                self.retire_gone_source(&target).await;
                Err(CalendarMutationError::NotFound)
            }
        }
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> Result<Vec<super::models::VisibleCalendar>, CalendarMutationError> {
        self.repository
            .list_visible_calendars(requester_id)
            .await
            .map_err(internal)
    }
}

impl<R, G, T> CalendarMutationServiceImpl<R, G, T>
where
    R: CalendarRepository,
    G: GoogleCalendarMutationProvider,
    T: CalendarAccessTokenProvider,
{
    /// Best-effort cleanup when the provider reports the event gone: the
    /// regular sync converges the projection either way.
    async fn retire_gone_source(&self, target: &CalendarEventMutationTarget) {
        self.repository
            .remove_google_source(
                target.account_id,
                target.calendar_id,
                target.master_provider_event_id(),
            )
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error=?error,
                    event_id=%target.event_id,
                    "failed to retire a provider-deleted calendar event source"
                );
            })
            .ok();
    }
}

fn validate_time(time: &EventTime) -> Result<(), CalendarMutationError> {
    if !time.is_valid() {
        return Err(CalendarMutationError::InvalidInput(
            "event end must be after its start".to_string(),
        ));
    }
    Ok(())
}

fn validate_attendee_emails<'a>(
    emails: impl Iterator<Item = &'a String>,
) -> Result<(), CalendarMutationError> {
    for email in emails {
        let trimmed = email.trim();
        if trimmed.is_empty() || !trimmed.contains('@') {
            return Err(CalendarMutationError::InvalidInput(format!(
                "invalid attendee email: {email:?}"
            )));
        }
    }
    Ok(())
}

fn provider_error(error: GoogleProviderError) -> CalendarMutationError {
    match error.kind() {
        GoogleProviderErrorKind::ReauthRequired => {
            CalendarMutationError::ReauthRequired(error.to_string())
        }
        GoogleProviderErrorKind::Transient | GoogleProviderErrorKind::SyncTokenExpired => {
            CalendarMutationError::Retryable(error.to_string())
        }
        GoogleProviderErrorKind::Permanent => {
            CalendarMutationError::ProviderRejected(error.to_string())
        }
    }
}

fn internal(error: rootcause::Report) -> CalendarMutationError {
    CalendarMutationError::Retryable(format!("{error:?}"))
}

#[cfg(test)]
mod test;
