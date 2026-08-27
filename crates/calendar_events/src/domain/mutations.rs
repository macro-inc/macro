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
        ActorInboxes, AttendeeResponseStatus, CalendarAttendeeInput, CalendarEvent,
        CalendarEventDraft, CalendarEventMutationTarget, CalendarEventPatch, CalendarEventUpsert,
        DisconnectedGoogleCalendar, EventReminders, EventTime, OccurrenceRange,
        REMINDER_METHOD_EMAIL, REMINDER_METHOD_POPUP, REMINDER_MINUTES_MAX, REMINDER_OVERRIDES_MAX,
    },
    ports::{
        CalendarAccessTokenProvider, CalendarDeletionScope, CalendarEventChange,
        CalendarEventWrite, CalendarEventWriteOutcome, CalendarMutationError,
        CalendarMutationService, CalendarRepository, CalendarRsvpScope, CalendarTokenError,
        CalendarUpdateScope, GoogleCalendarMutationProvider, GoogleInstanceUpdateOutcome,
        GoogleProviderError, GoogleProviderErrorKind, GoogleRsvpOutcome,
        GoogleSeriesMutationOutcome, RetiredCalendarEvent,
    },
};
use crate::domain::events::{CalendarEventMetadata, CalendarMacroEvent, CalendarTopicEvent};
use macro_event_broker::MacroEventBroker;

/// Calendar mutation use cases with provider, token, and persistence
/// details behind ports.
pub struct CalendarMutationServiceImpl<R, G, T, B> {
    repository: R,
    provider: G,
    tokens: T,
    macro_event_broker: B,
}

impl<R, G, T, B> CalendarMutationServiceImpl<R, G, T, B>
where
    R: CalendarRepository,
    G: GoogleCalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
{
    /// Construct the service from its ports.
    pub fn new(repository: R, provider: G, tokens: T, macro_event_broker: B) -> Self {
        Self {
            repository,
            provider,
            tokens,
            macro_event_broker,
        }
    }

    /// Publish one calendar topic event; failures are logged and dropped.
    ///
    /// The provider and the local projection are already updated by this
    /// point, so a publish failure must not fail the mutation.
    fn publish_calendar_event(&self, event: CalendarTopicEvent) {
        let _ = self
            .macro_event_broker
            .send_event(&CalendarMacroEvent::for_change(event))
            .inspect_err(|error| {
                tracing::error!(error=?error, "failed to publish calendar event");
            });
    }

    /// Announce every event a source retirement touched. Retiring a source
    /// does not necessarily remove the event — the row survives, rewritten
    /// from its next-best remaining source — so each event reports its own
    /// fate.
    fn publish_retirements(&self, retired: Vec<RetiredCalendarEvent>) {
        for event in retired {
            let metadata = CalendarEventMetadata {
                event_id: event.event_id,
                owner_id: event.owner_id,
            };
            self.publish_calendar_event(if event.deleted {
                CalendarTopicEvent::Deleted(metadata)
            } else {
                CalendarTopicEvent::Updated(metadata)
            });
        }
    }

    /// Announce what a write did to the canonical row. A write that changed
    /// nothing publishes nothing, so an idempotent replay stays quiet.
    fn publish_write_outcome(&self, outcome: &CalendarEventWriteOutcome) {
        let metadata = CalendarEventMetadata {
            event_id: outcome.event_id,
            owner_id: outcome.owner_id.clone(),
        };
        match outcome.change {
            CalendarEventChange::Created => {
                self.publish_calendar_event(CalendarTopicEvent::Created(metadata));
            }
            CalendarEventChange::Updated => {
                self.publish_calendar_event(CalendarTopicEvent::Updated(metadata));
            }
            CalendarEventChange::Unchanged => {}
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
        viewer: Option<&ActorInboxes>,
        upsert: CalendarEventUpsert,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        let mut event = upsert.event.clone();
        let outcome = self
            .repository
            .upsert_event(CalendarEventWrite::UserMutation(upsert))
            .await
            .map_err(|error| CalendarMutationError::PersistFailed(format!("{error:?}")))?;
        event.id = outcome.event_id;
        self.publish_write_outcome(&outcome);
        if let Some(viewer) = viewer {
            viewer.mark_attendees(&mut event.attendees);
        }
        Ok(event)
    }
}

impl<R, G, T, B> CalendarMutationService for CalendarMutationServiceImpl<R, G, T, B>
where
    R: CalendarRepository,
    G: GoogleCalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
{
    #[tracing::instrument(skip(self, requester_id, draft), err)]
    async fn create_event(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        mut draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        validate_time(&draft.time)?;
        validate_attendee_emails(draft.attendees.iter().map(|attendee| &attendee.email))?;
        if let Some(reminders) = &draft.reminders {
            validate_reminders(reminders)?;
        }
        let target = self
            .repository
            .get_creation_target(requester_id, email_link_id, calendar_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NoWritableCalendar)?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        ensure_organizer_attendee(&mut draft.attendees, &target.token_identity.email_address);
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
        self.persist_echo(target.actor.as_ref(), upsert).await
    }

    #[tracing::instrument(skip(self, requester_id, patch), err)]
    async fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
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
        if let Some(reminders) = &patch.reminders {
            validate_reminders(reminders)?;
        }
        if matches!(scope, CalendarUpdateScope::ThisEvent { .. })
            && patch.recurrence_lines.is_some()
        {
            return Err(CalendarMutationError::InvalidInput(
                "a single occurrence has no recurrence of its own; update the whole series to \
                 change the recurrence"
                    .to_string(),
            ));
        }
        let target = self.resolve_mutation_target(requester_id, event_id).await?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        let access_token = self.fetch_token(&target.token_identity).await?;
        let google_target = target.google_target(OccurrenceRange::maintenance_horizon(Utc::now()));
        match scope {
            CalendarUpdateScope::All => {
                let updated = self
                    .provider
                    .update_event(
                        &access_token,
                        &google_target,
                        target.master_provider_event_id(),
                        &patch,
                    )
                    .await
                    .map_err(provider_error)?;
                let Some(upsert) = updated else {
                    // The provider no longer has the event; retire the stale
                    // local source the same way a feed tombstone would.
                    self.retire_gone_source(&target).await;
                    return Err(CalendarMutationError::NotFound);
                };
                self.persist_echo(target.actor.as_ref(), upsert).await
            }
            CalendarUpdateScope::ThisEvent { recurrence_id } => {
                let outcome = self
                    .provider
                    .update_event_instance(
                        &access_token,
                        &google_target,
                        target.master_provider_event_id(),
                        &recurrence_id,
                        &patch,
                    )
                    .await
                    .map_err(provider_error)?;
                match outcome {
                    GoogleInstanceUpdateOutcome::Applied(upsert) => {
                        self.persist_echo(target.actor.as_ref(), *upsert).await
                    }
                    GoogleInstanceUpdateOutcome::OccurrenceGone(upsert) => {
                        // Nothing was written, but the provider's view of the
                        // series is fresher than whatever listed this
                        // occurrence — persist it so the phantom disappears.
                        self.persist_echo(target.actor.as_ref(), *upsert)
                            .await
                            .inspect_err(|error| {
                                tracing::warn!(
                                    error=?error,
                                    event_id=%target.event_id,
                                    "failed to persist the series refresh for a vanished occurrence"
                                );
                            })
                            .ok();
                        Err(CalendarMutationError::OccurrenceNotFound)
                    }
                    GoogleInstanceUpdateOutcome::SeriesGone => {
                        self.retire_gone_source(&target).await;
                        Err(CalendarMutationError::NotFound)
                    }
                }
            }
        }
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
            GoogleSeriesMutationOutcome::Applied(upsert) => self
                .persist_echo(target.actor.as_ref(), *upsert)
                .await
                .map(|_| ()),
            // Either the deletion removed the series or it was already
            // gone; retiring the local source converges both.
            GoogleSeriesMutationOutcome::SeriesDeleted | GoogleSeriesMutationOutcome::Gone => {
                // Retiring a recurring master's source also retires its
                // expanded instances, so this reports several events; each
                // announces its own fate.
                let retired = self
                    .repository
                    .remove_google_source(
                        target.account_id,
                        target.calendar_id,
                        target.master_provider_event_id(),
                    )
                    .await
                    .map_err(|error| CalendarMutationError::PersistFailed(format!("{error:?}")))?;
                self.publish_retirements(retired);
                Ok(())
            }
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
        let Some(actor) = target.actor.as_ref() else {
            return Err(CalendarMutationError::NotAttendee);
        };
        let access_token = self.fetch_token(&target.token_identity).await?;
        let outcome = self
            .provider
            .rsvp_event(
                &access_token,
                &target.google_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
                actor,
                response,
                &scope,
            )
            .await
            .map_err(provider_error)?;
        match outcome {
            GoogleRsvpOutcome::Applied(upsert) => {
                self.persist_echo(target.actor.as_ref(), *upsert).await
            }
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

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn disconnect_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        let disconnected = self
            .repository
            .disconnect_google_calendar(requester_id, email_link_id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)?;
        self.release_watch_channels(email_link_id, &disconnected)
            .await;
        Ok(())
    }
}

impl<R, G, T, B> CalendarMutationServiceImpl<R, G, T, B>
where
    R: CalendarRepository,
    G: GoogleCalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
{
    /// Close the push channels a disconnected calendar left open. Best-effort:
    /// the local calendars are already gone, so a notification that still
    /// arrives resolves to no watch target and is dropped. Stopping the
    /// channels only spares Google the retries until they expire.
    async fn release_watch_channels(
        &self,
        email_link_id: Uuid,
        disconnected: &DisconnectedGoogleCalendar,
    ) {
        if disconnected.watch_channels.is_empty() {
            return;
        }
        let access_token = match self
            .tokens
            .fetch_access_token(&disconnected.token_identity)
            .await
        {
            Ok(token) => token,
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    email_link_id=%email_link_id,
                    "no token to close the disconnected calendar's push channels"
                );
                return;
            }
        };
        for channel in &disconnected.watch_channels {
            self.provider
                .stop_watch_channel(
                    &access_token,
                    email_link_id,
                    &channel.channel_id,
                    &channel.resource_id,
                )
                .await
                .inspect_err(|error| {
                    tracing::warn!(
                        error=?error,
                        email_link_id=%email_link_id,
                        channel_id=%channel.channel_id,
                        "failed to close a disconnected calendar's push channel"
                    );
                })
                .ok();
        }
    }

    /// Best-effort cleanup when the provider reports the event gone: the
    /// regular sync converges the projection either way.
    async fn retire_gone_source(&self, target: &CalendarEventMutationTarget) {
        let retired = self
            .repository
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
            .unwrap_or_default();
        // The row may be gone now, so search cannot rediscover this by
        // re-reading Postgres — the retirement has to be announced.
        self.publish_retirements(retired);
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

/// Enforce Google's own reminder limits so the provider never rejects a
/// write we already accepted: at most five overrides, offsets within four
/// weeks, and only methods Google understands.
fn validate_reminders(reminders: &EventReminders) -> Result<(), CalendarMutationError> {
    if reminders.use_default && !reminders.overrides.is_empty() {
        return Err(CalendarMutationError::InvalidInput(
            "reminder overrides require useDefault to be off".to_string(),
        ));
    }
    if reminders.overrides.len() > REMINDER_OVERRIDES_MAX {
        return Err(CalendarMutationError::InvalidInput(format!(
            "an event allows at most {REMINDER_OVERRIDES_MAX} reminders"
        )));
    }
    for reminder in &reminders.overrides {
        if reminder.method != REMINDER_METHOD_POPUP && reminder.method != REMINDER_METHOD_EMAIL {
            return Err(CalendarMutationError::InvalidInput(format!(
                "unsupported reminder method: {:?}",
                reminder.method
            )));
        }
        if reminder.minutes > REMINDER_MINUTES_MAX {
            return Err(CalendarMutationError::InvalidInput(format!(
                "a reminder can fire at most {REMINDER_MINUTES_MAX} minutes before the event"
            )));
        }
    }
    Ok(())
}

fn ensure_organizer_attendee(attendees: &mut Vec<CalendarAttendeeInput>, organizer_email: &str) {
    let mut kept = false;
    attendees.retain_mut(|attendee| {
        if !attendee.email.eq_ignore_ascii_case(organizer_email) {
            return true;
        }
        if kept {
            return false;
        }
        attendee.response_status = Some(AttendeeResponseStatus::Accepted);
        kept = true;
        true
    });
    if kept {
        return;
    }
    attendees.insert(
        0,
        CalendarAttendeeInput {
            email: organizer_email.to_string(),
            is_optional: false,
            response_status: Some(AttendeeResponseStatus::Accepted),
        },
    );
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
