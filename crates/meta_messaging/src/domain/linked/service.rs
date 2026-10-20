//! Owner-bound account lifecycle and adopted-group use cases.
use super::{models::*, ports::*};
use crate::domain::{
    models::MessagingError, policy::SendAuthority, ports::PortResult, service::MessagingService,
};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// Composes personal authorization with shared native messaging orchestration.
#[derive(Clone)]
pub struct LinkedService {
    /// Independent rollout switches, never access grants.
    pub features: Features,
    /// Existing send state machine with a personal-account selector/transport.
    pub messaging: Arc<MessagingService>,
    /// Durable account and observer state.
    pub repository: Arc<dyn LinkedRepository>,
    /// Authenticated hosted-session transport.
    pub sessions: Arc<dyn Sessions>,
    native: Arc<dyn LinkedNative>,
}
impl LinkedService {
    /// Wire adapters only at the hosting composition root.
    pub fn new(
        features: Features,
        messaging: Arc<MessagingService>,
        repository: Arc<dyn LinkedRepository>,
        sessions: Arc<dyn Sessions>,
        native: Arc<dyn LinkedNative>,
    ) -> Self {
        Self {
            features,
            messaging,
            repository,
            sessions,
            native,
        }
    }
    fn human(authority: SendAuthority) -> PortResult<()> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        Ok(())
    }
    /// Personal settings never depend on team administration.
    pub async fn account(&self, user: &str) -> PortResult<Option<Account>> {
        self.repository.owned_account(user).await
    }
    /// Start explicit owner consent; replacement never inherits an old identity's authority.
    #[tracing::instrument(skip_all)]
    pub async fn connect(
        &self,
        user: &str,
        replace: bool,
        authority: SendAuthority,
    ) -> PortResult<Pairing> {
        Self::human(authority)?;
        if !self.features.pairing {
            return Err(MessagingError::ConfigurationRequired.into());
        }
        if let Some(account) = self.repository.owned_account(user).await?
            && account.state == AccountState::Connecting
            && let Some(pairing) = self.repository.pending_pairing(account.id).await?
        {
            self.sessions.start(&account, Some(&pairing)).await?;
            return Ok(pairing);
        }
        if replace && let Some(old) = self.repository.owned_account(user).await? {
            self.repository
                .disconnect_account(user, old.id, old.authorization_generation)
                .await?;
            if let Ok(scope) = old.scope() {
                self.sessions.stop(&scope, true).await?;
            }
        }
        let pairing = self.repository.begin_pairing(user, replace).await?;
        let account = self
            .repository
            .linked_account(pairing.account_id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        self.sessions.start(&account, Some(&pairing)).await?;
        Ok(pairing)
    }
    async fn flow(&self, user: &str, id: Uuid) -> PortResult<(Pairing, SessionScope)> {
        let pairing = self.repository.pairing(user, id).await?;
        let account = self
            .repository
            .linked_account(pairing.account_id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        if account.user_id != user
            || account.authorization_generation != pairing.authorization_generation
        {
            return Err(MessagingError::Forbidden.into());
        }
        Ok((pairing, account.scope()?))
    }
    /// Poll only the initiating user's live flow, with no persistent QR/challenge cache.
    pub async fn pair_state(&self, user: &str, id: Uuid) -> PortResult<PairState> {
        let snapshot = self.repository.pairing_snapshot(user, id).await?;
        if snapshot.consumed_at.is_some() || snapshot.expires_at <= Utc::now() {
            let account = self.repository.linked_account(snapshot.account_id).await?;
            let connected = snapshot.state == "connected"
                && account.as_ref().is_some_and(|a| {
                    a.authorization_generation == snapshot.authorization_generation
                        && a.state == AccountState::Connected
                });
            return Ok(PairState {
                state: if connected { "connected" } else { "expired" }.into(),
                qr: None,
                code: None,
                challenge: None,
                identity_jid: if connected {
                    account.and_then(|a| a.identity_jid)
                } else {
                    None
                },
                expires_at: snapshot.expires_at,
            });
        }
        let (pairing, scope) = self.flow(user, id).await?;
        let state = self.sessions.pair_state(&scope, id).await?;
        if state.state == "connected" {
            let identity = state
                .identity_jid
                .as_deref()
                .ok_or(MessagingError::Unavailable)?;
            if pairing
                .expected_identity_jid
                .as_deref()
                .is_some_and(|expected| expected != identity)
            {
                if self.repository.cancel_pairing(&pairing).await? {
                    self.sessions.stop(&scope, true).await?;
                }
                return Err(MessagingError::Conflict.into());
            }
            if let Err(error) = self.repository.complete_pairing(&pairing, identity).await {
                if self.repository.cancel_pairing(&pairing).await? {
                    let _ = self.sessions.stop(&scope, true).await;
                }
                return Err(error);
            }
        }
        Ok(state)
    }
    /// Continue authentication using the actual native authenticator assertion.
    pub async fn passkey(
        &self,
        user: &str,
        id: Uuid,
        response: &serde_json::Value,
        authority: SendAuthority,
    ) -> PortResult<()> {
        Self::human(authority)?;
        if !self.features.pairing {
            return Err(MessagingError::ConfigurationRequired.into());
        }
        let (_, scope) = self.flow(user, id).await?;
        self.sessions.passkey(&scope, id, response).await
    }
    /// Confirm a code the owner actually reviewed; never fabricate protocol completion.
    pub async fn confirm(&self, user: &str, id: Uuid, authority: SendAuthority) -> PortResult<()> {
        Self::human(authority)?;
        let (_, scope) = self.flow(user, id).await?;
        self.sessions.confirm(&scope, id).await
    }
    /// Cancellation fences new work before retiring the process.
    pub async fn cancel(&self, user: &str, id: Uuid) -> PortResult<()> {
        let (pairing, scope) = self.flow(user, id).await?;
        if self.repository.cancel_pairing(&pairing).await? {
            self.sessions.stop(&scope, true).await?;
        }
        Ok(())
    }
    /// Disconnect does not delete history or revoke separately established native access.
    pub async fn disconnect(
        &self,
        user: &str,
        generation: i64,
        authority: SendAuthority,
    ) -> PortResult<bool> {
        Self::human(authority)?;
        let account = self.account(user).await?.ok_or(MessagingError::NotFound)?;
        if account.authorization_generation != generation {
            if account.state == AccountState::Disconnected
                && Some(account.authorization_generation) == generation.checked_add(1)
            {
                return Ok(false);
            }
            return Err(MessagingError::Conflict.into());
        }
        // Stop future commands before any network unlink attempt. The supervisor
        // accepts retirement only for the exact old process/generation.
        self.repository
            .disconnect_account(user, account.id, generation)
            .await?;
        let remote = match account.scope() {
            Ok(scope) => self.sessions.stop(&scope, true).await.unwrap_or(false),
            Err(_) => false,
        };
        Ok(remote)
    }
    async fn ready(&self, user: &str) -> PortResult<Account> {
        self.repository
            .owned_account(user)
            .await?
            .filter(|a| a.state == AccountState::Connected)
            .ok_or_else(|| MessagingError::Disconnected.into())
    }
    /// Only a person's own joined groups are discoverable.
    pub async fn groups(&self, user: &str) -> PortResult<Vec<GroupInfo>> {
        if !self.features.adoption {
            return Err(MessagingError::ConfigurationRequired.into());
        }
        self.sessions
            .groups(&self.ready(user).await?.scope()?)
            .await
    }
    /// Adoption only binds an existing group; it never creates or joins one remotely.
    #[tracing::instrument(skip_all)]
    pub async fn adopt(
        &self,
        user: &str,
        request: &AdoptGroup,
        authority: SendAuthority,
    ) -> PortResult<Binding> {
        Self::human(authority)?;
        if !self.features.adoption {
            return Err(MessagingError::ConfigurationRequired.into());
        }
        if request.users.len() > 1024 || request.group_jid.len() > 256 {
            return Err(MessagingError::Invalid("invalid group audience").into());
        }
        let account = self.ready(user).await?;
        let group = self
            .sessions
            .group(&account.scope()?, &request.group_jid)
            .await?;
        let identity = account
            .identity_jid
            .as_deref()
            .ok_or(MessagingError::Forbidden)?;
        if group.jid != request.group_jid
            || group.community
            || group.disappearing
            || group.participant(identity).is_none()
            || Utc::now() - group.observed_at > chrono::Duration::minutes(2)
        {
            return Err(MessagingError::Forbidden.into());
        }
        self.native
            .authorize_adoption(user, request, &group)
            .await?;
        let binding = self.native.adopt(user, &account, request, &group).await?;
        self.sessions
            .allowlist(
                &account.scope()?,
                &self.repository.observing_groups(&account).await?,
            )
            .await?;
        self.repository.reconcile_group(&account, &group).await?;
        Ok(binding)
    }
    /// Review/grant native access independently of observing consent.
    pub async fn grant(
        &self,
        user: &str,
        channel: Uuid,
        users: &[String],
        authority: SendAuthority,
    ) -> PortResult<()> {
        Self::human(authority)?;
        if !self.features.adoption || users.is_empty() || users.len() > 100 {
            return Err(MessagingError::Forbidden.into());
        }
        let binding = self
            .repository
            .binding(channel)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let account = self.ready(user).await?;
        let group = self
            .sessions
            .group(&account.scope()?, &binding.group_jid)
            .await?;
        self.native
            .grant_access(user, &binding, users, &group)
            .await
    }
    /// Change the native content owner only through explicit native management.
    pub async fn transfer_owner(
        &self,
        user: &str,
        channel: Uuid,
        new_owner: &str,
        authority: SendAuthority,
    ) -> PortResult<()> {
        Self::human(authority)?;
        let binding = self
            .repository
            .binding(channel)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let account = self.ready(user).await?;
        let group = self
            .sessions
            .group(&account.scope()?, &binding.group_jid)
            .await?;
        self.native
            .transfer_owner(user, &binding, new_owner, &group)
            .await
    }
    /// Local detach with owning-domain management checks.
    pub async fn detach(
        &self,
        user: &str,
        channel: Uuid,
        authority: SendAuthority,
    ) -> PortResult<()> {
        Self::human(authority)?;
        let binding = self
            .repository
            .binding(channel)
            .await?
            .ok_or(MessagingError::NotFound)?;
        self.native.detach(user, &binding).await?;
        for account in self.repository.active_accounts().await? {
            if let Ok(scope) = account.scope() {
                let groups = self.repository.observing_groups(&account).await?;
                self.sessions.allowlist(&scope, &groups).await?;
            }
        }
        Ok(())
    }
    /// Keep consent leases independent of slow content/media materialization.
    #[tracing::instrument(skip_all)]
    pub async fn maintain_sessions(&self) -> PortResult<()> {
        use futures::{StreamExt, stream};
        let accounts = self.repository.active_accounts().await?;
        stream::iter(accounts)
            .for_each_concurrent(8, |account| async move {
                if !matches!(
                    account.state,
                    AccountState::Connected | AccountState::Offline | AccountState::Connecting
                ) {
                    return;
                }
                let Ok(scope) = account.scope() else { return };
                let Ok(bindings) = self.repository.observing_groups(&account).await else {
                    return;
                };
                if self.sessions.allowlist(&scope, &bindings).await.is_err()
                    && matches!(
                        account.state,
                        AccountState::Connected | AccountState::Offline
                    )
                    && let Ok(current) = self.sessions.start(&account, None).await
                {
                    let _ = self.sessions.allowlist(&current, &bindings).await;
                }
                if account.state == AccountState::Connecting
                    && let Ok(Some(pairing)) = self.repository.pending_pairing(account.id).await
                {
                    let _ = self.pair_state(&account.user_id, pairing.id).await;
                }
            })
            .await;
        Ok(())
    }
    async fn apply_event(
        &self,
        account: &Account,
        scope: &SessionScope,
        event: &Event,
    ) -> PortResult<()> {
        // The current owner transports retained envelopes from earlier physically
        // fenced epochs. Their immutable provenance is not a new send capability.
        if event.schema_version != 1
            || event.scope.account_id != account.id
            || event.scope.authorization_generation != account.authorization_generation
            || event.scope.owner_epoch <= 0
            || event.scope.owner_epoch > scope.owner_epoch
        {
            return Err(MessagingError::Conflict.into());
        }
        if let Some(group) = &event.group {
            self.repository.reconcile_group(account, group).await?;
        }
        if event.message.is_some() {
            self.native.ingest_linked(account, event).await?;
        }
        self.repository.record_account_event(event).await
    }
    /// Durable inbox consumer. Each bad event is deferred independently, allowing
    /// a later original to resolve an earlier reaction and other accounts to progress.
    #[tracing::instrument(skip_all)]
    pub async fn reconcile(&self) -> PortResult<usize> {
        let mut processed = 0;
        use futures::{StreamExt, stream};
        let mut tasks=stream::iter(self.repository.active_accounts().await?).map(|mut account|async move {
            let mut processed=0;

            // Read-only outcomes remain recoverable even after disconnect or replacement.
            for (command, generation) in self.repository.unresolved_commands(account.id).await? {
                if let Ok(result) = self.sessions.outcome(&account, generation, command).await
                    && result.command_id == command
                {
                    self.repository
                        .recover_outcome(
                            account.id,
                            generation,
                            command,
                            &result.source_id,
                            &result.state,
                        )
                        .await?;
                }
            }
            if !matches!(
                account.state,
                AccountState::Connected | AccountState::Offline | AccountState::Connecting
            ) {
                return Ok(0);
            }
            let scope = match account.scope() {
                Ok(scope) => scope,
                Err(_) => return Ok(0),
            };
            if account.state == AccountState::Connecting
                && let Some(pairing) = self.repository.pending_pairing(account.id).await?
            {
                let _ = self.pair_state(&account.user_id, pairing.id).await;
                if let Some(current) = self.repository.linked_account(account.id).await? {
                    account = current;
                }
            }
            for event in self.repository.pending_events(&account).await? {
                if let Err(error) = self.apply_event(&account, &scope, &event).await {
                    self.repository.defer_event(&event).await?;
                    tracing::warn!(account_id=%account.id,event_id=%event.event_id,code=error.current_context().code(),"Linked event deferred");
                }
            }
            let Ok(events) = self.sessions.events(&scope).await else { return Ok(processed); };
            for event in events {
                let persisted = match self.apply_event(&account, &scope, &event).await {
                    Ok(()) => true,
                    Err(error) => {
                        tracing::warn!(account_id=%account.id,event_id=%event.event_id,code=error.current_context().code(),"Linked event deferred");
                        self.repository.defer_event(&event).await.is_ok()
                    }
                };
                if persisted
                    && self
                        .sessions
                        .acknowledge(&scope, event.event_id)
                        .await
                        .is_ok()
                {
                    processed += 1;
                }
            }
            Ok::<usize,rootcause::Report<MessagingError>>(processed)
        }).buffer_unordered(8);
        while let Some(result) = tasks.next().await {
            match result {
                Ok(count) => processed += count,
                Err(error) => tracing::warn!(
                    code = error.current_context().code(),
                    "Linked account deferred"
                ),
            }
        }

        Ok(processed)
    }
}
