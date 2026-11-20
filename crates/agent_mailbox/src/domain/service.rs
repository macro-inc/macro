//! The agent mailbox use cases: provisioning and lifecycle for the teammate
//! side, and reading and sending for the agent itself.
//!
//! The agent's mailbox is always the one its own authenticated account owns;
//! no operation takes a mailbox id from the caller. Message ids the agent
//! passes are confined twice: the provider sees only the mailbox's own
//! credential, and the service checks the mailbox the provider reports.

#[cfg(test)]
mod test;

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    AgentMailbox, AgentMailboxError, AgentMailboxId, AgentMailboxView, CreateMailbox, MailMessage,
    MailboxState, MessageList, MessagePage, OutgoingMessage, ProviderMailboxId, ProviderMessageId,
    ProvisionRequest, ProvisionedMailbox, ProvisioningFailure, ReplyMessage, Reservation,
    SendAuthority, SendKind, SendLimits, SendReservation, SentMessage, StoredGrant, VendorMode,
};
use crate::domain::ports::{
    AgentDirectory, AgentMailboxRepository, LeaseToken, MailboxClient, MailboxKeyCipher,
    MailboxProvisioner, ProviderError,
};

/// A paused mailbox is released after this long.
pub const PAUSED_RETENTION: Duration = Duration::days(30);

/// A provisioning attempt that stalled this long is retried by the sweep.
pub const PROVISIONING_RETRY_AFTER: Duration = Duration::minutes(1);

/// Most recipients on one message, `to` and `cc` together.
pub const MAX_RECIPIENTS: usize = 20;

/// Largest plain-text body Macro sends.
pub const MAX_BODY_BYTES: usize = 256 * 1024;

/// Longest subject line.
pub const MAX_SUBJECT_CHARS: usize = 998;

/// Most messages on one page.
pub const MAX_PAGE_SIZE: u8 = 50;

/// Send records are kept this long: past the daily cap's window and the
/// provider's 24-hour idempotency replay.
pub const SEND_RECORD_RETENTION: Duration = Duration::days(7);

/// How long one attempt holds a mailbox's lease. Every provider call in an
/// attempt times out well inside it (a handful of calls at 20 seconds each).
pub const LEASE_TTL: Duration = Duration::minutes(3);

/// How long the sweep leaves a mailbox alone after one of its steps failed.
pub const SWEEP_RETRY_DELAY: Duration = Duration::minutes(5);

/// The provider replays an idempotent request for 24 hours; a send whose
/// outcome is unknown is retried only inside this, with a margin.
pub const PROVIDER_REPLAY_WINDOW: Duration = Duration::hours(23);

/// Send records the sweep prunes per round.
pub const PRUNE_BATCH: u32 = 1000;

/// Mailboxes the sweep moves on per round.
pub const SWEEP_BATCH: u16 = 50;

/// The agent mailbox service.
pub struct AgentMailboxService<Repository, Vendor, Cipher, Directory> {
    repository: Repository,
    vendor: Vendor,
    cipher: Cipher,
    directory: Directory,
    vendor_mode: VendorMode,
    limits: SendLimits,
}

/// What one sweep round did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Mailboxes it moved on.
    pub advanced: usize,
    /// Mailboxes whose step failed; the next round retries them.
    pub failed: usize,
}

fn internal<Error: std::error::Error + Send + Sync + 'static>(error: Error) -> AgentMailboxError {
    AgentMailboxError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Maps a provider failure on a mail operation to what the agent sees.
fn mail_error(error: ProviderError) -> AgentMailboxError {
    match error {
        ProviderError::NotFound => AgentMailboxError::NotFound,
        ProviderError::NotConfigured => AgentMailboxError::NotConfigured,
        ProviderError::Rejected | ProviderError::AddressTaken | ProviderError::QuotaExceeded => {
            AgentMailboxError::Rejected
        }
        ProviderError::SendLimit => AgentMailboxError::SendLimit {
            retry_at: Utc::now() + Duration::hours(1),
        },
        ProviderError::Throttled | ProviderError::Unavailable => AgentMailboxError::Unavailable,
    }
}

impl<Repository, Vendor, Cipher, Directory>
    AgentMailboxService<Repository, Vendor, Cipher, Directory>
where
    Repository: AgentMailboxRepository,
    Vendor: MailboxProvisioner + MailboxClient,
    Cipher: MailboxKeyCipher,
    Directory: AgentDirectory,
{
    /// Compose the service.
    pub fn new(
        repository: Repository,
        vendor: Vendor,
        cipher: Cipher,
        directory: Directory,
        vendor_mode: VendorMode,
        limits: SendLimits,
    ) -> Self {
        Self {
            repository,
            vendor,
            cipher,
            directory,
            vendor_mode,
            limits,
        }
    }

    fn view(&self, mailbox: &AgentMailbox) -> AgentMailboxView {
        AgentMailboxView {
            id: mailbox.id,
            address: mailbox.address.clone(),
            state: mailbox.state,
            last_error: mailbox.last_error,
            provider: mailbox.provider,
            vendor_mode: self.vendor_mode,
        }
    }

    /// Give an agent a mailbox. Safe to repeat with the same request id: one
    /// request makes at most one provider mailbox. Answers once the mailbox is
    /// active, failed, or still provisioning after one bounded attempt.
    #[tracing::instrument(skip_all, fields(agent_mailbox.request_id = %request.request_id, agent_mailbox.id, agent_mailbox.state), err)]
    pub async fn provision(
        &self,
        request: ProvisionRequest,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        let is_agent = self
            .directory
            .is_agent(&request.agent)
            .await
            .map_err(internal)?;
        if !is_agent {
            return Err(AgentMailboxError::NotAnAgent);
        }

        let reservation = self
            .repository
            .reserve(&request, AgentMailboxId::generate())
            .await
            .map_err(internal)?;
        let mailbox = match reservation {
            Reservation::New(mailbox) | Reservation::Existing(mailbox) => mailbox,
            Reservation::AgentHasMailbox(_) => return Err(AgentMailboxError::AlreadyProvisioned),
        };
        tracing::Span::current().record("agent_mailbox.id", mailbox.id.to_string());

        if matches!(
            mailbox.state,
            MailboxState::Provisioning | MailboxState::Failed
        ) {
            self.advance(mailbox.id).await?;
        }
        let mailbox = self
            .repository
            .live_mailbox(&request.agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)?;
        tracing::Span::current().record("agent_mailbox.state", mailbox.state.as_ref());
        Ok(self.view(&mailbox))
    }

    /// Run `step` on the mailbox under its lease, giving the lease back after.
    /// `None` when another attempt holds the lease.
    async fn with_lease<Value>(
        &self,
        id: AgentMailboxId,
        step: impl AsyncFnOnce(AgentMailbox, LeaseToken) -> Result<Value, AgentMailboxError>,
    ) -> Result<Option<Value>, AgentMailboxError> {
        let token = LeaseToken(Uuid::now_v7());
        let Some(mailbox) = self
            .repository
            .claim(id, token, Utc::now(), LEASE_TTL)
            .await
            .map_err(internal)?
        else {
            return Ok(None);
        };

        let outcome = step(mailbox, token).await;
        let unclaimed = self.repository.unclaim(id, token).await.map_err(internal);
        let value = outcome?;
        unclaimed?;
        Ok(Some(value))
    }

    /// Take a provisioning mailbox as far as it goes, under its lease: create
    /// (or find) it at the provider, set the provider's send cap, mint and
    /// store its scoped credential, and activate it. Each step is recorded
    /// before the next, so a retry resumes rather than repeats. A mailbox
    /// paused or released meanwhile keeps that state; nothing is revoked
    /// here, so a stored credential is only ever revoked by a release.
    async fn advance(&self, id: AgentMailboxId) -> Result<(), AgentMailboxError> {
        let advanced = self
            .with_lease(id, async |mut mailbox, token| {
                if !matches!(
                    mailbox.state,
                    MailboxState::Provisioning | MailboxState::Failed
                ) {
                    return Ok(());
                }

                let provisioned = match (&mailbox.provider_mailbox_id, &mailbox.address) {
                    (Some(id), Some(address)) => ProvisionedMailbox {
                        id: id.clone(),
                        address: address.clone(),
                    },
                    _ => match self.create(&mailbox).await {
                        Ok(provisioned) => {
                            let recorded = self
                                .repository
                                .record_created(mailbox.id, token, &provisioned)
                                .await
                                .map_err(internal)?;
                            if !recorded {
                                return Err(AgentMailboxError::Busy);
                            }
                            provisioned
                        }
                        Err(error) => return self.stop(&mailbox, token, error).await,
                    },
                };
                mailbox.provider_mailbox_id = Some(provisioned.id.clone());

                if mailbox.grant.is_none() {
                    // Before the credential exists, so no send can precede the provider's cap.
                    if let Err(error) = self
                        .vendor
                        .apply_guardrails(&provisioned.id, self.limits.per_hour)
                        .await
                    {
                        return self.stop(&mailbox, token, error).await;
                    }

                    // The mailbox id is the grant's idempotency key: a retry
                    // inside the provider's replay window gets the same
                    // credential back instead of minting another.
                    let (grant_id, key) = match self
                        .vendor
                        .grant_access(&provisioned.id, mailbox.id.0)
                        .await
                    {
                        Ok(grant) => grant,
                        Err(error) => return self.stop(&mailbox, token, error).await,
                    };
                    let encrypted = self
                        .cipher
                        .encrypt(mailbox.id, &mailbox.agent, &key)
                        .await
                        .map_err(internal)?;
                    let grant = StoredGrant {
                        id: grant_id,
                        key: encrypted,
                    };
                    let recorded = self
                        .repository
                        .record_grant(mailbox.id, token, &grant)
                        .await
                        .map_err(internal)?;
                    if !recorded {
                        return Err(AgentMailboxError::Busy);
                    }
                }

                self.repository
                    .activate(mailbox.id, token)
                    .await
                    .map_err(internal)?;
                Ok(())
            })
            .await?;

        // Another attempt holds the lease and finishes on its own.
        if advanced.is_none() {
            tracing::info!(agent_mailbox.id = %id, "agent mailbox provisioning already in progress");
        }
        Ok(())
    }

    /// Create the mailbox at the provider, first looking for one an earlier
    /// attempt made, and falling back once to a suffixed address when taken.
    async fn create(&self, mailbox: &AgentMailbox) -> Result<ProvisionedMailbox, ProviderError> {
        if let Some(existing) = self.vendor.find_mailbox(mailbox.id).await? {
            return Ok(existing);
        }

        let request = CreateMailbox {
            idempotency_key: mailbox.id.0,
            owner_tag: mailbox.id,
            local_part: mailbox.requested_local_part.clone(),
            display_name: mailbox.display_name.clone(),
        };
        match self.vendor.create_mailbox(&request).await {
            Err(ProviderError::AddressTaken) => {
                let Some(local_part) = &mailbox.requested_local_part else {
                    return Err(ProviderError::AddressTaken);
                };
                // A different idempotency key: the first one is bound to the taken address.
                let suffixed = CreateMailbox {
                    idempotency_key: mailbox.request_id,
                    local_part: Some(local_part.with_suffix(mailbox.id)),
                    ..request
                };
                self.vendor.create_mailbox(&suffixed).await
            }
            result => result,
        }
    }

    /// Record why provisioning stopped. Transient failures stay
    /// `Provisioning` for the sweep; the rest are `Failed` until a retry.
    async fn stop(
        &self,
        mailbox: &AgentMailbox,
        token: LeaseToken,
        error: ProviderError,
    ) -> Result<(), AgentMailboxError> {
        let (state, failure) = match error {
            ProviderError::Throttled | ProviderError::Unavailable => {
                (MailboxState::Provisioning, ProvisioningFailure::Unavailable)
            }
            ProviderError::NotConfigured => {
                (MailboxState::Failed, ProvisioningFailure::NotConfigured)
            }
            ProviderError::AddressTaken => {
                (MailboxState::Failed, ProvisioningFailure::AddressTaken)
            }
            ProviderError::QuotaExceeded => {
                (MailboxState::Failed, ProvisioningFailure::QuotaExceeded)
            }
            ProviderError::Rejected | ProviderError::NotFound | ProviderError::SendLimit => {
                (MailboxState::Failed, ProvisioningFailure::Rejected)
            }
        };
        tracing::warn!(agent_mailbox.id = %mailbox.id, failure = failure.as_ref(), "agent mailbox provisioning stopped");
        self.repository
            .record_failure(mailbox.id, token, state, failure)
            .await
            .map_err(internal)
    }

    /// The agent's mailbox, in any state but released.
    pub async fn status(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        let mailbox = self
            .repository
            .live_mailbox(agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)?;
        Ok(self.view(&mailbox))
    }

    /// Stop the agent from reading or sending, keeping the mailbox and its mail.
    #[tracing::instrument(skip_all, err)]
    pub async fn pause(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        self.move_mailbox(
            agent,
            &[
                MailboxState::Active,
                MailboxState::Provisioning,
                MailboxState::Failed,
            ],
            MailboxState::Paused,
            now,
        )
        .await
    }

    /// Undo a pause.
    #[tracing::instrument(skip_all, err)]
    pub async fn resume(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        let mailbox = self
            .repository
            .live_mailbox(agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)?;

        // A mailbox paused before its credential was stored goes back to provisioning.
        let resumed_state = if mailbox.grant.is_some() {
            MailboxState::Active
        } else {
            MailboxState::Provisioning
        };
        self.move_mailbox(agent, &[MailboxState::Paused], resumed_state, now)
            .await
    }

    async fn move_mailbox(
        &self,
        agent: &MacroUserIdStr<'_>,
        from: &[MailboxState],
        to: MailboxState,
        now: DateTime<Utc>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        let mailbox = self
            .repository
            .live_mailbox(agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)?;
        if mailbox.state != to {
            let moved = self
                .repository
                .transition(mailbox.id, from, to, now)
                .await
                .map_err(internal)?;
            if !moved {
                return Err(AgentMailboxError::NotReady(mailbox.state));
            }
        }
        let mailbox = self
            .repository
            .live_mailbox(agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)?;
        Ok(self.view(&mailbox))
    }

    /// Delete the agent's mailbox and its mail at the provider. Safe to
    /// repeat. The mailbox stops serving the agent at once; when another
    /// operation holds it or the provider fails, it stays releasing, answers
    /// `Busy` or `Unavailable`, and the sweep finishes it.
    #[tracing::instrument(skip_all, err)]
    pub async fn release(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<(), AgentMailboxError> {
        let Some(mailbox) = self
            .repository
            .live_mailbox(agent)
            .await
            .map_err(internal)?
        else {
            return Ok(());
        };
        let all_live = [
            MailboxState::Provisioning,
            MailboxState::Active,
            MailboxState::Failed,
            MailboxState::Paused,
        ];
        self.repository
            .transition(mailbox.id, &all_live, MailboxState::Releasing, now)
            .await
            .map_err(internal)?;
        self.tear_down(mailbox.id, now).await
    }

    /// Under the lease, revoke the credential and delete the provider mailbox
    /// of a releasing mailbox, then mark it released. Reads the row as the
    /// lease found it, so a credential or mailbox recorded by an attempt that
    /// finished just before is torn down too.
    async fn tear_down(
        &self,
        id: AgentMailboxId,
        now: DateTime<Utc>,
    ) -> Result<(), AgentMailboxError> {
        let torn_down = self
            .with_lease(id, async |mailbox, token| {
                if mailbox.state != MailboxState::Releasing {
                    return Ok(());
                }

                if let Some(grant) = &mailbox.grant {
                    self.vendor
                        .revoke_access(&grant.id)
                        .await
                        .map_err(mail_error)?;
                    self.repository
                        .clear_grant(mailbox.id, token)
                        .await
                        .map_err(internal)?;
                }

                // A create whose response was lost may still have made a mailbox.
                let provider_mailbox = match mailbox.provider_mailbox_id {
                    Some(id) => Some(id),
                    None => self
                        .vendor
                        .find_mailbox(mailbox.id)
                        .await
                        .map_err(mail_error)?
                        .map(|found| found.id),
                };
                if let Some(provider_mailbox) = provider_mailbox {
                    self.vendor
                        .delete_mailbox(&provider_mailbox)
                        .await
                        .map_err(mail_error)?;
                }

                self.repository
                    .finish_release(mailbox.id, token, now)
                    .await
                    .map_err(internal)?;
                Ok(())
            })
            .await?;
        torn_down.ok_or(AgentMailboxError::Busy)
    }

    /// One round of background upkeep: finish stalled provisioning and
    /// releases, and release mailboxes paused longer than [`PAUSED_RETENTION`].
    /// A mailbox whose step fails is left alone for [`SWEEP_RETRY_DELAY`], so
    /// failing mailboxes never crowd out the rest.
    #[tracing::instrument(skip_all, fields(agent_mailbox.sweep.advanced, agent_mailbox.sweep.failed), err)]
    pub async fn sweep(&self, now: DateTime<Utc>) -> Result<SweepReport, AgentMailboxError> {
        let paused_before = now - PAUSED_RETENTION;
        let due = self
            .repository
            .due_for_sweep(
                now,
                now - PROVISIONING_RETRY_AFTER,
                paused_before,
                SWEEP_BATCH,
            )
            .await
            .map_err(internal)?;

        let mut report = SweepReport::default();
        for mailbox in due {
            let id = mailbox.id;
            let outcome = match mailbox.state {
                MailboxState::Provisioning => self.advance(id).await,
                MailboxState::Releasing => self.tear_down(id, now).await,
                MailboxState::Paused => self.expire_paused(id, paused_before, now).await,
                MailboxState::Active | MailboxState::Failed | MailboxState::Released => Ok(()),
            };
            match outcome {
                Ok(()) => report.advanced += 1,
                Err(error) => {
                    tracing::warn!(agent_mailbox.id = %id, error = %error, "agent mailbox sweep step failed");
                    self.repository
                        .defer_sweep(id, now + SWEEP_RETRY_DELAY)
                        .await
                        .map_err(internal)?;
                    report.failed += 1;
                }
            }
        }

        self.repository
            .prune_sends(now - SEND_RECORD_RETENTION, PRUNE_BATCH)
            .await
            .map_err(internal)?;

        let span = tracing::Span::current();
        span.record("agent_mailbox.sweep.advanced", report.advanced);
        span.record("agent_mailbox.sweep.failed", report.failed);
        Ok(report)
    }

    /// Release a mailbox paused past retention, unless it was resumed since
    /// the sweep read it: the state and its timestamp are rechecked in the
    /// same write that starts the release.
    async fn expire_paused(
        &self,
        id: AgentMailboxId,
        paused_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<(), AgentMailboxError> {
        let started = self
            .repository
            .release_if_paused_before(id, paused_before, now)
            .await
            .map_err(internal)?;
        if !started {
            return Ok(());
        }
        self.tear_down(id, now).await
    }

    /// The agent's mailbox, ready to use, with its decrypted credential.
    async fn usable(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<
        (
            AgentMailbox,
            ProviderMailboxId,
            crate::domain::models::MailboxKey,
        ),
        AgentMailboxError,
    > {
        let mailbox = self
            .repository
            .live_mailbox(agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)?;

        match mailbox.state {
            MailboxState::Active => {}
            MailboxState::Paused => return Err(AgentMailboxError::Paused),
            state => return Err(AgentMailboxError::NotReady(state)),
        }

        let (Some(provider_mailbox), Some(grant)) =
            (mailbox.provider_mailbox_id.clone(), &mailbox.grant)
        else {
            return Err(AgentMailboxError::NotReady(mailbox.state));
        };
        let key = self
            .cipher
            .decrypt(mailbox.id, &mailbox.agent, &grant.key)
            .await
            .map_err(internal)?;
        Ok((mailbox, provider_mailbox, key))
    }

    /// A page of the agent's messages, newest first.
    #[tracing::instrument(skip_all, fields(agent_mailbox.id, agent_mailbox.message_count), err)]
    pub async fn list_messages(
        &self,
        agent: &MacroUserIdStr<'_>,
        page: MessagePage,
    ) -> Result<MessageList, AgentMailboxError> {
        if page
            .limit
            .is_some_and(|limit| limit == 0 || limit > MAX_PAGE_SIZE)
        {
            return Err(AgentMailboxError::Invalid(format!(
                "limit must be 1 to {MAX_PAGE_SIZE}"
            )));
        }
        let (mailbox, provider_mailbox, key) = self.usable(agent).await?;
        tracing::Span::current().record("agent_mailbox.id", mailbox.id.to_string());

        let mut list = self
            .vendor
            .list_messages(&provider_mailbox, &key, &page)
            .await
            .map_err(mail_error)?;

        // The credential already confines the listing; a message from another
        // mailbox here would be a provider fault, and is never shown.
        let before = list.messages.len();
        list.messages
            .retain(|message| message.mailbox == provider_mailbox);
        if list.messages.len() != before {
            tracing::error!(agent_mailbox.id = %mailbox.id, dropped = before - list.messages.len(), "provider listed messages from another mailbox");
        }
        tracing::Span::current().record("agent_mailbox.message_count", list.messages.len());
        Ok(list)
    }

    /// One of the agent's messages.
    #[tracing::instrument(skip_all, fields(agent_mailbox.id), err)]
    pub async fn read_message(
        &self,
        agent: &MacroUserIdStr<'_>,
        message: &ProviderMessageId,
    ) -> Result<MailMessage, AgentMailboxError> {
        let (mailbox, provider_mailbox, key) = self.usable(agent).await?;
        tracing::Span::current().record("agent_mailbox.id", mailbox.id.to_string());
        self.confined_message(&mailbox, &provider_mailbox, &key, message)
            .await
    }

    /// Read a message and check the provider says it is in this mailbox.
    async fn confined_message(
        &self,
        mailbox: &AgentMailbox,
        provider_mailbox: &ProviderMailboxId,
        key: &crate::domain::models::MailboxKey,
        message: &ProviderMessageId,
    ) -> Result<MailMessage, AgentMailboxError> {
        let found = self
            .vendor
            .read_message(provider_mailbox, key, message)
            .await
            .map_err(mail_error)?;
        if &found.mailbox != provider_mailbox {
            tracing::error!(agent_mailbox.id = %mailbox.id, "provider returned a message from another mailbox");
            return Err(AgentMailboxError::NotFound);
        }
        Ok(found)
    }

    /// Send a new message from the agent's mailbox. Safe to repeat with the
    /// same idempotency key.
    #[tracing::instrument(skip_all, fields(agent_mailbox.id, agent_mailbox.recipient_count = message.to.len() + message.cc.len()), err)]
    pub async fn send(
        &self,
        agent: &MacroUserIdStr<'_>,
        authority: SendAuthority,
        idempotency_key: Uuid,
        message: OutgoingMessage,
    ) -> Result<SentMessage, AgentMailboxError> {
        require_approval(&authority)?;
        validate_outgoing(&message)?;
        let (mailbox, provider_mailbox, key) = self.usable(agent).await?;
        tracing::Span::current().record("agent_mailbox.id", mailbox.id.to_string());

        let sent = self
            .with_reserved_send(&mailbox, idempotency_key, SendKind::Message, async || {
                self.vendor
                    .send(&provider_mailbox, &key, &message, idempotency_key)
                    .await
            })
            .await?;
        Ok(sent)
    }

    /// Reply to a message in the agent's mailbox. Safe to repeat with the same
    /// idempotency key.
    #[tracing::instrument(skip_all, fields(agent_mailbox.id), err)]
    pub async fn reply(
        &self,
        agent: &MacroUserIdStr<'_>,
        authority: SendAuthority,
        message: &ProviderMessageId,
        idempotency_key: Uuid,
        reply: ReplyMessage,
    ) -> Result<SentMessage, AgentMailboxError> {
        require_approval(&authority)?;
        validate_body(&reply.text_body)?;
        let (mailbox, provider_mailbox, key) = self.usable(agent).await?;
        tracing::Span::current().record("agent_mailbox.id", mailbox.id.to_string());

        // Confined before replying: a model-supplied id from another mailbox
        // is a NotFound here, never a reply.
        self.confined_message(&mailbox, &provider_mailbox, &key, message)
            .await?;

        self.with_reserved_send(&mailbox, idempotency_key, SendKind::Reply, async || {
            self.vendor
                .reply(&provider_mailbox, &key, message, &reply, idempotency_key)
                .await
        })
        .await
    }

    /// Count a send against the caps, run it, and record the outcome. A send
    /// the provider definitely refused frees its slot; one whose outcome is
    /// unknown keeps it, and a retry with the same key resends under the same
    /// provider idempotency key while the provider still dedupes it
    /// ([`PROVIDER_REPLAY_WINDOW`]); after that the outcome stays unknown.
    async fn with_reserved_send(
        &self,
        mailbox: &AgentMailbox,
        idempotency_key: Uuid,
        kind: SendKind,
        send: impl AsyncFnOnce() -> Result<SentMessage, ProviderError>,
    ) -> Result<SentMessage, AgentMailboxError> {
        let now = Utc::now();
        let reservation = self
            .repository
            .reserve_send(
                mailbox.id,
                idempotency_key,
                kind,
                self.limits,
                now,
                now - PROVIDER_REPLAY_WINDOW,
            )
            .await
            .map_err(internal)?;
        match reservation {
            SendReservation::Proceed => {}
            SendReservation::AlreadySent(sent) => return Ok(sent),
            SendReservation::OutcomeUnknown => return Err(AgentMailboxError::SendOutcomeUnknown),
            SendReservation::LimitReached { retry_at } => {
                return Err(AgentMailboxError::SendLimit { retry_at });
            }
        }

        match send().await {
            Ok(sent) => {
                self.repository
                    .complete_send(mailbox.id, idempotency_key, &sent)
                    .await
                    .map_err(internal)?;
                Ok(sent)
            }
            Err(ProviderError::Unavailable) => Err(AgentMailboxError::Unavailable),
            Err(error) => {
                self.repository
                    .cancel_send(mailbox.id, idempotency_key)
                    .await
                    .map_err(internal)?;
                Err(mail_error(error))
            }
        }
    }
}

/// The send policy every email send from a program follows: an agent's
/// program must quote its owner's approval.
fn require_approval(authority: &SendAuthority) -> Result<(), AgentMailboxError> {
    match authority {
        SendAuthority::Person => Ok(()),
        SendAuthority::Program { confirmation } => {
            let confirmed = confirmation
                .as_deref()
                .is_some_and(|quote| !quote.trim().is_empty());
            if confirmed {
                Ok(())
            } else {
                Err(AgentMailboxError::ConfirmationRequired)
            }
        }
    }
}

fn validate_body(body: &str) -> Result<(), AgentMailboxError> {
    if body.trim().is_empty() {
        return Err(AgentMailboxError::Invalid("the body is empty".to_owned()));
    }
    if body.len() > MAX_BODY_BYTES {
        return Err(AgentMailboxError::Invalid(format!(
            "the body is over {MAX_BODY_BYTES} bytes"
        )));
    }
    Ok(())
}

fn validate_outgoing(message: &OutgoingMessage) -> Result<(), AgentMailboxError> {
    let recipients = message.to.len() + message.cc.len();
    if message.to.is_empty() || recipients > MAX_RECIPIENTS {
        return Err(AgentMailboxError::Invalid(format!(
            "a message needs 1 to {MAX_RECIPIENTS} recipients"
        )));
    }
    let every_address_valid = message
        .to
        .iter()
        .chain(&message.cc)
        .all(|address| email_validator::is_valid_email(address));
    if !every_address_valid {
        return Err(AgentMailboxError::Invalid(
            "a recipient is not an email address".to_owned(),
        ));
    }
    if message.subject.chars().count() > MAX_SUBJECT_CHARS || message.subject.contains(['\r', '\n'])
    {
        return Err(AgentMailboxError::Invalid(
            "the subject is too long or spans lines".to_owned(),
        ));
    }
    validate_body(&message.text_body)
}

/// The agent mailbox use cases, as the inbound adapters call them.
pub trait AgentMailboxUseCases: Send + Sync + 'static {
    /// See [`AgentMailboxService::provision`].
    fn provision(
        &self,
        request: ProvisionRequest,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::status`].
    fn status(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::pause`].
    fn pause(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::resume`].
    fn resume(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::release`].
    fn release(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::list_messages`].
    fn list_messages(
        &self,
        agent: &MacroUserIdStr<'_>,
        page: MessagePage,
    ) -> impl Future<Output = Result<MessageList, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::read_message`].
    fn read_message(
        &self,
        agent: &MacroUserIdStr<'_>,
        message: &ProviderMessageId,
    ) -> impl Future<Output = Result<MailMessage, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::send`].
    fn send(
        &self,
        agent: &MacroUserIdStr<'_>,
        authority: SendAuthority,
        idempotency_key: Uuid,
        message: OutgoingMessage,
    ) -> impl Future<Output = Result<SentMessage, AgentMailboxError>> + Send;
    /// See [`AgentMailboxService::reply`].
    fn reply(
        &self,
        agent: &MacroUserIdStr<'_>,
        authority: SendAuthority,
        message: &ProviderMessageId,
        idempotency_key: Uuid,
        reply: ReplyMessage,
    ) -> impl Future<Output = Result<SentMessage, AgentMailboxError>> + Send;
}

impl<Repository, Vendor, Cipher, Directory> AgentMailboxUseCases
    for AgentMailboxService<Repository, Vendor, Cipher, Directory>
where
    Repository: AgentMailboxRepository,
    Vendor: MailboxProvisioner + MailboxClient,
    Cipher: MailboxKeyCipher,
    Directory: AgentDirectory,
{
    fn provision(
        &self,
        request: ProvisionRequest,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send {
        AgentMailboxService::provision(self, request)
    }
    fn status(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send {
        AgentMailboxService::status(self, agent)
    }
    fn pause(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send {
        AgentMailboxService::pause(self, agent, now)
    }
    fn resume(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<AgentMailboxView, AgentMailboxError>> + Send {
        AgentMailboxService::resume(self, agent, now)
    }
    fn release(
        &self,
        agent: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), AgentMailboxError>> + Send {
        AgentMailboxService::release(self, agent, now)
    }
    fn list_messages(
        &self,
        agent: &MacroUserIdStr<'_>,
        page: MessagePage,
    ) -> impl Future<Output = Result<MessageList, AgentMailboxError>> + Send {
        AgentMailboxService::list_messages(self, agent, page)
    }
    fn read_message(
        &self,
        agent: &MacroUserIdStr<'_>,
        message: &ProviderMessageId,
    ) -> impl Future<Output = Result<MailMessage, AgentMailboxError>> + Send {
        AgentMailboxService::read_message(self, agent, message)
    }
    fn send(
        &self,
        agent: &MacroUserIdStr<'_>,
        authority: SendAuthority,
        idempotency_key: Uuid,
        message: OutgoingMessage,
    ) -> impl Future<Output = Result<SentMessage, AgentMailboxError>> + Send {
        AgentMailboxService::send(self, agent, authority, idempotency_key, message)
    }
    fn reply(
        &self,
        agent: &MacroUserIdStr<'_>,
        authority: SendAuthority,
        message: &ProviderMessageId,
        idempotency_key: Uuid,
        reply: ReplyMessage,
    ) -> impl Future<Output = Result<SentMessage, AgentMailboxError>> + Send {
        AgentMailboxService::reply(self, agent, authority, message, idempotency_key, reply)
    }
}
