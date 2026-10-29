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
        for (user, id) in pending {
            if let Err(error) = self.confirm_replacement(&user, id).await {
                tracing::warn!(operation_id=%id,error=?error,"calendar replacement recovery needs another attempt or organizer review");
            }
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
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
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
            let target = self.replacement_target(user, &active).await?;
            return self.replacement_view(&active, &target).await;
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
            )
            .await
            .map_err(provider_error)?;
        if !snapshot.is_organizer {
            return Err(CalendarMutationError::InvalidInput("Only the meeting organizer can replace an invitation. Open Outlook to manage your own response.".into()));
        }
        let operation = self
            .repository
            .prepare_replacement(CalendarReplacement {
                id: Uuid::now_v7(),
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
                    self.announce_retirements(&target.owner_id, target.email_link_id, retired)
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
