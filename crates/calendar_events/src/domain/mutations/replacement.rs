//! Organizer authorization, confirmation, and ordered durable replacement policy.
use super::*;
use crate::domain::{models::CalendarProvider, replacement::*};

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository + CalendarReplacementRepository,
    G: CalendarMutationProvider + CalendarReplacementProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    async fn replacement_target(
        &self,
        user: &str,
        operation: &CalendarReplacement,
    ) -> Result<CalendarCreationTarget, CalendarMutationError> {
        let target = self
            .repository
            .get_creation_target(user, None, Some(operation.calendar_id))
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        if target.token_identity.provider != CalendarProvider::Outlook {
            return Err(CalendarMutationError::InvalidInput(
                "This replacement belongs to an Outlook calendar".into(),
            ));
        }
        Ok(target)
    }
    async fn load_replacement(
        &self,
        user: &str,
        id: Uuid,
    ) -> Result<CalendarReplacement, CalendarMutationError> {
        self.repository
            .replacement(user, id)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)
    }
    async fn replacement_view(
        &self,
        operation: &CalendarReplacement,
        target: &CalendarCreationTarget,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        let url = if let Some(id) = &operation.replacement_provider_id {
            let token = self.fetch_token(&target.token_identity).await?;
            self.provider
                .event_url(
                    &token,
                    &target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                    id,
                    None,
                )
                .await
                .map_err(provider_error)?
        } else {
            None
        };
        Ok(operation.view(url))
    }

    #[tracing::instrument(
        name = "calendar.replacement_recovery",
        skip_all,
        fields(claimed = pending.len())
    )]
    async fn confirm_claimed_replacements(&self, pending: Vec<(String, Uuid)>) {
        for (user, id) in pending {
            if let Err(error) = self.confirm_replacement(&user, id).await {
                tracing::warn!(operation_id=%id,error=?error,"calendar replacement recovery needs another attempt or organizer review");
            }
        }
    }
}

/// A replacement carries the editor's details, guests and reminders. Its
/// conference is `remove_conference`, Outlook has no guest policy, an
/// out-of-office event has no meeting to replace, and one occurrence has no
/// repeat rule of its own.
fn check_replacement_changes(
    changes: &CalendarEventPatch,
    recurrence_id: Option<&str>,
) -> Result<(), CalendarMutationError> {
    if changes.conference.is_some()
        || changes.guest_policy.is_some()
        || changes.out_of_office.is_some()
    {
        return Err(CalendarMutationError::InvalidInput(
            "A replacement carries only the event's details, guests and reminders".into(),
        ));
    }
    if recurrence_id.is_some() && changes.recurrence_lines.is_some() {
        return Err(CalendarMutationError::InvalidInput(
            "The repeat rule applies to all events. Replace all events to change it.".into(),
        ));
    }
    if let Some(time) = &changes.time {
        validate_time(time)?;
    }
    if let Some(attendees) = &changes.attendees {
        validate_attendee_emails(attendees.iter().map(|attendee| &attendee.email))?;
    }
    if let Some(reminders) = &changes.reminders {
        validate_reminders(reminders)?;
    }
    Ok(())
}

impl<R, G, T, B, N> CalendarReplacementService for CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository + CalendarReplacementRepository,
    G: CalendarMutationProvider + CalendarReplacementProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    async fn recover_replacements(&self) -> Result<usize, rootcause::Report> {
        let pending = self.repository.claim_pending_replacements(16).await?;
        let count = pending.len();
        if count > 0 {
            self.confirm_claimed_replacements(pending).await;
        }
        Ok(count)
    }
    async fn prepare_replacement(
        &self,
        user: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        recurrence_id: Option<String>,
        remove_conference: bool,
        changes: CalendarEventPatch,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        check_replacement_changes(&changes, recurrence_id.as_deref())?;
        let target = self
            .resolve_mutation_target(user, event_id, calendar_id)
            .await?;
        if target.is_read_only {
            return Err(CalendarMutationError::ReadOnly);
        }
        if target.token_identity.provider != CalendarProvider::Outlook {
            return Err(CalendarMutationError::InvalidInput(
                "Use ordinary editing for this calendar provider".into(),
            ));
        }
        self.require_provider_writes(target.token_identity.provider)?;
        if let Some(active) = self
            .repository
            .active_replacement(user, target.calendar_id, target.master_provider_event_id())
            .await
            .map_err(internal)?
        {
            // A preview nobody confirmed froze the editor's older changes, so
            // it gives way to this one. A started operation is only resumed.
            let started = active.next_step > 0 || active.command.is_some();
            let discarded = !started
                && self
                    .repository
                    .discard_replacement(user, active.id)
                    .await
                    .map_err(internal)?;
            // A discard that found nothing lost to a confirmation or to the
            // client's own discard; only an operation still there is resumed.
            if !discarded
                && let Some(active) = self
                    .repository
                    .active_replacement(user, target.calendar_id, target.master_provider_event_id())
                    .await
                    .map_err(internal)?
            {
                let target = self.replacement_target(user, &active).await?;
                return self.replacement_view(&active, &target).await;
            }
        }
        let token = self.fetch_token(&target.token_identity).await?;
        let snapshot = self
            .provider
            .inspect_replacement(
                &token,
                &target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
                recurrence_id.as_deref(),
                remove_conference,
                &changes,
            )
            .await
            .map_err(provider_error)?;
        if !snapshot.is_organizer {
            return Err(CalendarMutationError::InvalidInput("Only the meeting organizer can replace an invitation. Open Outlook to manage your own response.".into()));
        }
        let id = Uuid::now_v7();
        let operation = self
            .repository
            .prepare_replacement(CalendarReplacement {
                id,
                user_id: user.into(),
                calendar_id: target.calendar_id,
                event_id,
                master_id: target.master_provider_event_id().into(),
                recurrence_id,
                snapshot,
                next_step: 0,
                command: None,
                replacement_provider_id: None,
                result: None,
            })
            .await
            .map_err(internal)?;
        // A concurrent prepare stored its preview first, without this
        // request's edits: a preview is never handed to another request.
        if operation.id != id {
            if operation.next_step == 0 && operation.command.is_none() {
                return Err(CalendarMutationError::Retryable(
                    "Another replacement of this event is being prepared. Try again.".into(),
                ));
            }
            let target = self.replacement_target(user, &operation).await?;
            return self.replacement_view(&operation, &target).await;
        }
        Ok(operation.view(None))
    }
    async fn replacement_status(
        &self,
        user: &str,
        id: Uuid,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        let operation = self.load_replacement(user, id).await?;
        let target = self.replacement_target(user, &operation).await?;
        self.replacement_view(&operation, &target).await
    }
    async fn discard_replacement(&self, user: &str, id: Uuid) -> Result<(), CalendarMutationError> {
        if !self
            .repository
            .discard_replacement(user, id)
            .await
            .map_err(internal)?
        {
            return Err(CalendarMutationError::InvalidInput("A confirmed replacement cannot be discarded. Check its progress before taking another action.".into()));
        }
        Ok(())
    }
    async fn event_provider_url(
        &self,
        user: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        recurrence_id: Option<String>,
    ) -> Result<Option<String>, CalendarMutationError> {
        let target = self
            .resolve_mutation_target(user, event_id, calendar_id)
            .await?;
        if target.token_identity.provider != CalendarProvider::Outlook {
            return Ok(None);
        }
        let token = self.fetch_token(&target.token_identity).await?;
        self.provider
            .event_url(
                &token,
                &target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now())),
                target.master_provider_event_id(),
                recurrence_id.as_deref(),
            )
            .await
            .map_err(provider_error)
    }
    async fn confirm_replacement(
        &self,
        user: &str,
        id: Uuid,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        // Bound a request's work; the client resumes the journal for larger series.
        for _ in 0..8 {
            let operation = self.load_replacement(user, id).await?;
            let target = self.replacement_target(user, &operation).await?;
            if operation.result.is_some() {
                return self.replacement_view(&operation, &target).await;
            }
            self.require_provider_writes(target.token_identity.provider)?;
            let token = self.fetch_token(&target.token_identity).await?;
            let provider_target =
                target.provider_target(OccurrenceRange::maintenance_horizon(Utc::now()));
            if operation.next_step == operation.snapshot.write_count() {
                let created_id = operation
                    .replacement_provider_id
                    .as_deref()
                    .ok_or_else(|| {
                        CalendarMutationError::PersistFailed(
                            "Replacement identity is missing".into(),
                        )
                    })?;
                let echo = self.provider.replacement_echo(&token,&provider_target,created_id).await.map_err(provider_error)?
                    .ok_or_else(|| CalendarMutationError::ProviderRejected("The replacement was removed in Outlook. Review your calendar before continuing.".into()))?;
                let event = self.persist_echo(target.actor.as_ref(), echo).await?;
                if operation.recurrence_id.is_some() {
                    if let Some(echo) = self
                        .provider
                        .replacement_echo(&token, &provider_target, &operation.master_id)
                        .await
                        .map_err(provider_error)?
                    {
                        self.persist_echo(target.actor.as_ref(), echo).await?;
                    }
                } else {
                    let retired = self
                        .repository
                        .remove_provider_source(
                            target.account_id,
                            target.calendar_id,
                            &operation.master_id,
                        )
                        .await
                        .map_err(internal)?;
                    self.announce_retirements(
                        &target.owner_id,
                        target.email_link_id,
                        target.token_identity.provider,
                        retired,
                    )
                    .await;
                }
                self.repository
                    .complete_replacement(id, &event)
                    .await
                    .map_err(internal)?;
                continue;
            }
            let (command, allow_create) = match &operation.command {
                Some(command) => (command.clone(), false),
                None => {
                    let command = self
                        .provider
                        .prepare_replacement_write(&token, &provider_target, &operation)
                        .await
                        .map_err(provider_error)?;
                    if !self
                        .repository
                        .start_replacement_step(id, operation.next_step, &command)
                        .await
                        .map_err(internal)?
                    {
                        continue;
                    }
                    (command, true)
                }
            };
            match self
                .provider
                .apply_replacement_write(&token, &provider_target, &command, allow_create)
                .await
                .map_err(provider_error)?
            {
                ReplacementWriteOutcome::Rejected(error) => {
                    self.repository
                        .reject_replacement_create(id)
                        .await
                        .map_err(internal)?;
                    return Err(provider_error(error));
                }
                ReplacementWriteOutcome::Unconfirmed => {
                    return self.replacement_status(user, id).await;
                }
                ReplacementWriteOutcome::Applied(created) => {
                    self.repository
                        .finish_replacement_step(id, operation.next_step, created.as_deref())
                        .await
                        .map_err(internal)?;
                }
            }
        }
        self.replacement_status(user, id).await
    }
}
