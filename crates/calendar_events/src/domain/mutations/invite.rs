//! Adding guests with a full attendee write, for organizers and for guests
//! of a Google event the organizer lets invite others while the guest list
//! is visible. The actor acts only as the inbox the addressed copy syncs
//! through.
use std::collections::HashSet;

use super::*;
use crate::domain::capabilities::{EventAccess, GuestPolicy, ViewerCapabilities};
use crate::domain::models::{CalendarProvider, OwnedInbox};

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    /// The stored guest list a mutation of `scope` addresses: the
    /// occurrence's own list when it carries one, which Google keeps complete
    /// for that occurrence, else the series attendees.
    pub(super) async fn stored_attendees(
        &self,
        event_id: Uuid,
        scope: &CalendarUpdateScope,
    ) -> Result<Vec<CalendarAttendee>, CalendarMutationError> {
        if let CalendarUpdateScope::ThisEvent { recurrence_id } = scope
            && let Some(overrides) = self
                .repository
                .get_occurrence_override_attendees(event_id, recurrence_id)
                .await
                .map_err(internal)?
        {
            return Ok(overrides);
        }
        self.repository
            .get_event_attendees(event_id)
            .await
            .map_err(internal)
    }

    pub(super) async fn add_guests(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        guests: Vec<CalendarAttendeeInput>,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        if guests.is_empty() {
            return Err(CalendarMutationError::InvalidInput(
                "name at least one guest to invite".to_string(),
            ));
        }
        validate_attendee_emails(guests.iter().map(|guest| &guest.email))?;
        let target = self
            .resolve_mutation_target(requester_id, event_id, calendar_id)
            .await?;
        tracing::Span::current().record(
            "provider",
            tracing::field::debug(target.token_identity.provider),
        );
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        // A guest added to a snapshot would be invited to a private copy the
        // meeting never hears about.
        if target.is_snapshot {
            return Err(CalendarMutationError::Snapshot);
        }
        self.require_provider_writes(target.token_identity.provider)?;
        let Some(actor) = target
            .actor
            .as_ref()
            .and_then(|actor| actor.through(target.email_link_id))
        else {
            return Err(CalendarMutationError::NotAttendee);
        };
        let stored = self.stored_attendees(event_id, &scope).await?;
        let capabilities = copy_capabilities(&target, &stored);
        if !capabilities.invite_guests {
            return Err(invite_refusal(
                capabilities,
                target.guest_policy,
                target.token_identity.provider,
            ));
        }
        let guests = uninvited_guests(guests, &stored);
        let access_token = self.fetch_token(&target.token_identity).await?;
        let outcome = self
            .provider
            .add_attendees(
                &access_token,
                &target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
                &actor,
                &guests,
                &scope,
            )
            .await
            .map_err(provider_error)?;
        match outcome {
            ProviderInviteOutcome::Applied(upsert) => match &scope {
                CalendarUpdateScope::All => self.persist_echo(Some(&actor), *upsert).await,
                CalendarUpdateScope::ThisEvent { recurrence_id } => {
                    self.persist_occurrence_echo(Some(&actor), *upsert, recurrence_id)
                        .await
                }
            },
            ProviderInviteOutcome::OccurrenceGone(upsert) => {
                // Nothing was written, but the provider's view of the series
                // is fresher than whatever listed this occurrence.
                self.persist_echo(Some(&actor), *upsert)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(
                            error = ?error,
                            event_id = %target.event_id,
                            "failed to persist the series refresh for a vanished occurrence"
                        );
                    })
                    .ok();
                Err(CalendarMutationError::OccurrenceNotFound)
            }
            ProviderInviteOutcome::NotAttendee => Err(CalendarMutationError::NotAttendee),
            ProviderInviteOutcome::Forbidden(policy) => {
                self.record_guest_policy(&target, policy).await;
                Err(CalendarMutationError::GuestsCannotInvite)
            }
            ProviderInviteOutcome::GuestListHidden(policy) => {
                self.record_guest_policy(&target, policy).await;
                Err(CalendarMutationError::GuestListHidden)
            }
            ProviderInviteOutcome::Gone => {
                self.retire_gone_source(&target).await;
                Err(CalendarMutationError::NotFound)
            }
        }
    }
}

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    /// Store the guest policy Google reported when it refused an invite.
    /// Incremental sync resends only changed events, so the stored policy can
    /// predate the organizer's choice; recording it stops every viewer from
    /// offering the invite.
    async fn record_guest_policy(&self, target: &CalendarEventMutationTarget, policy: GuestPolicy) {
        if policy == target.guest_policy {
            return;
        }
        match self
            .repository
            .record_guest_policy(target.event_id, policy)
            .await
        {
            Ok(()) => {
                self.refresh
                    .calendar_changed(&target.owner_id, target.email_link_id, false)
                    .await;
            }
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    event_id = %target.event_id,
                    "failed to record the guest policy Google reported"
                );
            }
        }
    }
}

/// Why an actor without `invite_guests` may not add guests. Every guest may
/// answer, so a seat on the event shows as `rsvp`. Outlook lets only the
/// organizer change a meeting, so its guests may never invite.
fn invite_refusal(
    capabilities: ViewerCapabilities,
    policy: GuestPolicy,
    provider: CalendarProvider,
) -> CalendarMutationError {
    if !capabilities.rsvp {
        CalendarMutationError::NotAttendee
    } else if provider == CalendarProvider::Outlook
        || !(policy.can_modify || policy.can_invite_others)
    {
        CalendarMutationError::GuestsCannotInvite
    } else {
        CalendarMutationError::GuestListHidden
    }
}

/// What the actor may do with the addressed copy through its inbox, judged
/// against its stored guest list.
pub(crate) fn copy_capabilities(
    target: &CalendarEventMutationTarget,
    stored: &[CalendarAttendee],
) -> ViewerCapabilities {
    if target.actor.is_none() {
        return ViewerCapabilities::NONE;
    }
    ViewerCapabilities::for_access(
        EventAccess {
            is_read_only: target.is_read_only,
            organizer_email: target.organizer_email.as_deref(),
            attendees: stored,
            guest_policy: target.guest_policy,
            is_snapshot: target.is_snapshot,
        },
        target.copy_inbox(),
    )
}

/// The requested guests not already on the stored list, each once.
fn uninvited_guests(
    guests: Vec<CalendarAttendeeInput>,
    stored: &[CalendarAttendee],
) -> Vec<CalendarAttendeeInput> {
    let mut seen: HashSet<String> = stored
        .iter()
        .map(|attendee| attendee.email.to_lowercase())
        .collect();
    guests
        .into_iter()
        .filter(|guest| seen.insert(guest.email.trim().to_lowercase()))
        .collect()
}

/// Split the guest list a caller without the right to remove guests
/// submitted into the guests it adds. Any stored guest missing from it is a
/// removal and is refused. The row of the copy's inbox, the actor's own, is
/// exempt: the editor leaves the viewer out of the list it submits, and
/// leaving an event is a decline, not an edit. A changed optional flag on an
/// existing guest is a modification such a caller cannot make, so it is
/// ignored.
pub(super) fn guest_list_additions(
    submitted: Vec<CalendarAttendeeInput>,
    stored: &[CalendarAttendee],
    inbox: Option<&OwnedInbox>,
) -> Result<Vec<CalendarAttendeeInput>, CalendarMutationError> {
    let submitted_emails: HashSet<String> = submitted
        .iter()
        .map(|attendee| attendee.email.trim().to_lowercase())
        .collect();
    let removes_a_guest = stored.iter().any(|attendee| {
        !submitted_emails.contains(&attendee.email.to_lowercase())
            && !inbox.is_some_and(|inbox| inbox.matches(&attendee.email))
    });
    if removes_a_guest {
        return Err(CalendarMutationError::InvalidInput(
            "guests can add guests but not remove them".to_string(),
        ));
    }
    Ok(uninvited_guests(submitted, stored))
}

/// The span outcome of an invite.
pub(super) fn invite_outcome(
    result: &Result<CalendarEvent, CalendarMutationError>,
) -> &'static str {
    match result {
        Ok(_) => "invited",
        Err(CalendarMutationError::GuestsCannotInvite) => "guests_cannot_invite",
        Err(CalendarMutationError::GuestListHidden) => "guest_list_hidden",
        Err(CalendarMutationError::NotAttendee) => "not_attendee",
        Err(CalendarMutationError::ReadOnly) => "read_only",
        Err(CalendarMutationError::Snapshot) => "snapshot",
        Err(CalendarMutationError::NotFound | CalendarMutationError::OccurrenceNotFound) => {
            "not_found"
        }
        Err(CalendarMutationError::InvalidInput(_)) => "invalid_input",
        Err(_) => "failed",
    }
}
