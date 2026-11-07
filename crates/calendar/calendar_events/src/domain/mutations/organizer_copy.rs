//! Writing through the organizer's copy. Google names the calendar an event
//! was made on as its organizer, so an event made on a secondary calendar
//! that lists the inbox's own address reaches the inbox twice: the
//! organizer's copy on the secondary calendar and an invitation on its
//! primary calendar, one entity whose canonical copy is the invitation. Only
//! the organizer's copy takes the organizer's changes, as in Google's own
//! client, so those changes go through it, and the addressed copy is then
//! read back so the entity shows them without waiting for sync. Google
//! carries them to the addressed copy some seconds later, so until then the
//! response shows the meeting as the organizer's copy has it, as the stored
//! entity does.
use super::*;

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    /// Apply what the provider keeps on each copy (reminders, availability)
    /// to the addressed copy, then the meeting's changes through the
    /// organizer's copy. In that order the organizer's write is the fresher
    /// one, so the addressed copy's echo, which Google has yet to update,
    /// cannot take the meeting's content back.
    #[tracing::instrument(
        name = "calendar.update_through_organizer_copy",
        skip(self, requester_id, target, patch, scope),
        fields(
            event_id = %target.event_id,
            calendar_id = %target.calendar_id,
            organizer_calendar_id = %organizer_calendar_id,
            read_back = tracing::field::Empty,
        ),
        err
    )]
    pub(super) async fn update_through_organizer_copy(
        &self,
        requester_id: &str,
        target: CalendarEventMutationTarget,
        organizer_calendar_id: Uuid,
        mut patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        let own = CalendarEventPatch {
            reminders: patch.reminders.take(),
            transparency: patch.transparency.take(),
            ..CalendarEventPatch::default()
        };
        let organizer_copy = self
            .resolve_mutation_target(requester_id, target.event_id, Some(organizer_calendar_id))
            .await?;
        if own.is_empty() {
            let organized = self
                .update_copy(requester_id, organizer_copy, patch, scope.clone())
                .await?;
            return Ok(self.read_back(&target, &scope, organized).await);
        }
        let addressed = self
            .update_copy(requester_id, target.clone(), own, scope.clone())
            .await?;
        let organized = self
            .update_copy(requester_id, organizer_copy, patch, scope)
            .await?;
        tracing::Span::current().record("read_back", "own_fields");
        Ok(with_meeting_of(&target, addressed, &organized))
    }

    /// Add guests through the organizer's copy, then read the addressed
    /// copy back.
    #[tracing::instrument(
        name = "calendar.invite_through_organizer_copy",
        skip(self, requester_id, target, guests, scope),
        fields(
            event_id = %target.event_id,
            calendar_id = %target.calendar_id,
            organizer_calendar_id = %organizer_calendar_id,
            read_back = tracing::field::Empty,
        ),
        err
    )]
    pub(super) async fn invite_through_organizer_copy(
        &self,
        requester_id: &str,
        target: CalendarEventMutationTarget,
        organizer_calendar_id: Uuid,
        guests: Vec<CalendarAttendeeInput>,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        let organizer_copy = self
            .resolve_mutation_target(requester_id, target.event_id, Some(organizer_calendar_id))
            .await?;
        let invited = self
            .add_guests_to(&organizer_copy, guests, scope.clone())
            .await?;
        Ok(self.read_back(&target, &scope, invited).await)
    }

    /// Delete through the organizer's copy, which cancels the event for
    /// every guest, then read the addressed copy back so the cancelled
    /// invitation leaves the entity too.
    #[tracing::instrument(
        name = "calendar.delete_through_organizer_copy",
        skip(self, requester_id, target, scope),
        fields(
            event_id = %target.event_id,
            calendar_id = %target.calendar_id,
            organizer_calendar_id = %organizer_calendar_id,
            read_back = tracing::field::Empty,
        ),
        err
    )]
    pub(super) async fn delete_through_organizer_copy(
        &self,
        requester_id: &str,
        target: CalendarEventMutationTarget,
        organizer_calendar_id: Uuid,
        scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        let organizer_copy = self
            .resolve_mutation_target(requester_id, target.event_id, Some(organizer_calendar_id))
            .await?;
        self.delete_copy(&organizer_copy, &scope).await?;
        let read_back = match self.refreshed_copy(&target).await {
            Ok(Some(upsert)) => match self.persist_echo(target.actor.as_ref(), upsert).await {
                Ok(_) => "refreshed",
                Err(error) => {
                    tracing::warn!(error = ?error, "failed to persist the read-back copy");
                    "failed"
                }
            },
            Ok(None) => {
                self.retire_gone_source(&target).await;
                "gone"
            }
            Err(error) => {
                tracing::warn!(error = ?error, "failed to read the copy back after a delete");
                "failed"
            }
        };
        tracing::Span::current().record("read_back", read_back);
        Ok(())
    }

    /// The addressed copy as the provider now has it, after a write through
    /// the organizer's copy. The write already succeeded, so a failed read
    /// falls back to the organizer copy's echo and leaves the rest to sync.
    async fn read_back(
        &self,
        target: &CalendarEventMutationTarget,
        scope: &CalendarUpdateScope,
        written: CalendarEvent,
    ) -> CalendarEvent {
        let refreshed = match self.refreshed_copy(target).await {
            Ok(Some(upsert)) => match scope {
                CalendarUpdateScope::All => self.persist_echo(target.actor.as_ref(), upsert).await,
                CalendarUpdateScope::ThisEvent { recurrence_id } => {
                    self.persist_occurrence_echo(target.actor.as_ref(), upsert, recurrence_id)
                        .await
                }
            },
            // The change took the inbox off the event, so the organizer's
            // copy is all that is left of it.
            Ok(None) => {
                self.retire_gone_source(target).await;
                tracing::Span::current().record("read_back", "gone");
                return written;
            }
            Err(error) => Err(error),
        };
        match refreshed {
            Ok(event) => {
                tracing::Span::current().record("read_back", "refreshed");
                with_meeting_of(target, event, &written)
            }
            Err(error) => {
                tracing::warn!(error = ?error, "failed to read the copy back after a write");
                tracing::Span::current().record("read_back", "failed");
                written
            }
        }
    }

    async fn refreshed_copy(
        &self,
        target: &CalendarEventMutationTarget,
    ) -> Result<Option<CalendarEventUpsert>, CalendarMutationError> {
        let access_token = self.fetch_token(&target.token_identity).await?;
        self.provider
            .refresh_event(
                &access_token,
                &target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
            )
            .await
            .map_err(provider_error)
    }
}

/// The addressed copy's echo as Google will show it once it carries the
/// organizer's write: a copy older than that write takes the meeting's
/// content, schedule, and guests from the organizer copy's echo and keeps its
/// own reminders, availability, and access, then the viewer is marked again
/// against the guests it now lists.
fn with_meeting_of(
    target: &CalendarEventMutationTarget,
    mut addressed: CalendarEvent,
    organized: &CalendarEvent,
) -> CalendarEvent {
    if addressed.updated_at >= organized.updated_at {
        return addressed;
    }
    addressed.title = organized.title.clone();
    addressed.description = organized.description.clone();
    addressed.location = organized.location.clone();
    addressed.visibility = organized.visibility;
    addressed.status = organized.status;
    addressed.time = organized.time.clone();
    addressed.recurrence_lines = organized.recurrence_lines.clone();
    addressed.organizer_email = organized.organizer_email.clone();
    addressed.organizer_name = organized.organizer_name.clone();
    addressed.conference_url = organized.conference_url.clone();
    addressed.conference_provider = organized.conference_provider;
    addressed.attendees = organized.attendees.clone();
    addressed.guest_policy = organized.guest_policy;
    addressed.updated_at = organized.updated_at;
    if let Some(viewer) = &target.actor {
        viewer.mark_event(&mut addressed, target.email_link_id);
    }
    addressed
}
