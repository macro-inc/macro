//! Writing one copy of an event: the update and delete every route ends in,
//! addressed to the copy the caller named or, for the organizer's changes,
//! the organizer's copy.
use super::*;

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    /// Apply a validated patch to the copy `target` addresses.
    pub(super) async fn update_copy(
        &self,
        requester_id: &str,
        target: CalendarEventMutationTarget,
        mut patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        self.require_provider_writes(target.token_identity.provider)?;
        validate_conference(target.token_identity.provider, patch.conference)?;
        // The stored list is the baseline — an occurrence's own list when
        // an occurrence-scoped patch addresses one — so a retained guest's
        // per-instance RSVP wins over their series status.
        let stored = self.stored_attendees(target.event_id, &scope).await?;
        let capabilities = invite::copy_capabilities(&target, &stored);
        // Checked before any guest is invited, so a refused change leaves
        // the event untouched.
        self.require_detail_rights(
            target.event_id,
            &scope,
            capabilities,
            target.is_snapshot,
            &mut patch,
        )
        .await?;
        guest_policy::require_guest_policy_rights(&target, &scope, capabilities, &mut patch)?;
        if patch.is_empty() {
            return Err(CalendarMutationError::InvalidInput(EMPTY_PATCH.to_string()));
        }
        if let Some(mut attendees) = patch.attendees.take() {
            if capabilities.remove_guests {
                preserve_retained_attendee_state(&mut attendees, &stored);
                patch.attendees = Some(attendees);
            } else {
                // A guest who may not remove guests only adds, through the
                // invite path, which keeps every guest the provider holds.
                let additions =
                    invite::guest_list_additions(attendees, &stored, target.copy_inbox())?;
                if !additions.is_empty() {
                    let invited = self
                        .invite_guests(
                            requester_id,
                            target.event_id,
                            Some(target.calendar_id),
                            additions,
                            scope.clone(),
                        )
                        .await?;
                    if patch.is_empty() {
                        return Ok(invited);
                    }
                } else if patch.is_empty() {
                    return Err(CalendarMutationError::InvalidInput(EMPTY_PATCH.to_string()));
                }
            }
        }
        let access_token = self.fetch_token(&target.token_identity).await?;
        let google_target =
            target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now()));
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
                    ProviderInstanceUpdateOutcome::Applied(upsert) => {
                        self.persist_occurrence_echo(target.actor.as_ref(), *upsert, &recurrence_id)
                            .await
                    }
                    ProviderInstanceUpdateOutcome::OccurrenceGone(upsert) => {
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
                    ProviderInstanceUpdateOutcome::SeriesGone => {
                        self.retire_gone_source(&target).await;
                        Err(CalendarMutationError::NotFound)
                    }
                }
            }
        }
    }

    /// Delete the copy `target` addresses, or the occurrences `scope` names.
    pub(super) async fn delete_copy(
        &self,
        target: &CalendarEventMutationTarget,
        scope: &CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        self.require_provider_writes(target.token_identity.provider)?;
        let access_token = self.fetch_token(&target.token_identity).await?;
        let google_target =
            target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now()));
        let outcome = match scope {
            CalendarDeletionScope::All => {
                self.provider
                    .delete_event(
                        &access_token,
                        &google_target,
                        target.master_provider_event_id(),
                    )
                    .await
                    .map_err(provider_error)?;
                ProviderSeriesMutationOutcome::SeriesDeleted
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
            ProviderSeriesMutationOutcome::Applied(upsert) => self
                .persist_echo(target.actor.as_ref(), *upsert)
                .await
                .map(|_| ()),
            // Either the deletion removed the series or it was already
            // gone; retiring the local source converges both.
            ProviderSeriesMutationOutcome::SeriesDeleted | ProviderSeriesMutationOutcome::Gone => {
                // Retiring a recurring master's source also retires its
                // expanded instances, so this reports several events; each
                // announces its own fate.
                let retired = self
                    .repository
                    .remove_provider_source(
                        target.account_id,
                        target.calendar_id,
                        target.master_provider_event_id(),
                    )
                    .await
                    .map_err(|error| CalendarMutationError::PersistFailed(format!("{error:?}")))?;
                self.announce_retirements(&target.owner_id, target.email_link_id, retired)
                    .await;
                Ok(())
            }
        }
    }
}
