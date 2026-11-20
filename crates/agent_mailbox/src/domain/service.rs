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
    AgentMailbox, AgentMailboxError, AgentMailboxView, CreateMailbox, MailMessage, MailboxState,
    MessageList, MessagePage, OutgoingMessage, ProviderMailboxId, ProviderMessageId,
    ProvisionRequest, ProvisionedMailbox, ProvisioningFailure, ReplyMessage, Reservation, SendKind,
    SendLimits, SendReservation, SentMessage, StoredGrant, VendorMode,
};
use crate::domain::ports::{
    AgentDirectory, AgentMailboxRepository, MailboxClient, MailboxKeyCipher, MailboxProvisioner,
    ProviderError,
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
            .reserve(&request, crate::domain::models::AgentMailboxId::generate())
            .await
            .map_err(internal)?;
        let mailbox = match reservation {
            Reservation::New(mailbox) | Reservation::Existing(mailbox) => mailbox,
            Reservation::AgentHasMailbox(_) => return Err(AgentMailboxError::AlreadyProvisioned),
        };
        tracing::Span::current().record("agent_mailbox.id", mailbox.id.to_string());

        let mailbox = match mailbox.state {
            MailboxState::Provisioning | MailboxState::Failed => self.advance(mailbox).await?,
            MailboxState::Active
            | MailboxState::Paused
            | MailboxState::Releasing
            | MailboxState::Released => mailbox,
        };
        tracing::Span::current().record("agent_mailbox.state", mailbox.state.as_ref());
        Ok(self.view(&mailbox))
    }

    /// Take a provisioning mailbox as far as it goes: create (or find) it at the
    /// provider, mint its credential, and activate it. Each step is recorded
    /// before the next, so a retry resumes rather than repeats.
    async fn advance(&self, mut mailbox: AgentMailbox) -> Result<AgentMailbox, AgentMailboxError> {
        let provisioned = match (&mailbox.provider_mailbox_id, &mailbox.address) {
            (Some(id), Some(address)) => ProvisionedMailbox {
                id: id.clone(),
                address: address.clone(),
            },
            _ => match self.create(&mailbox).await {
                Ok(provisioned) => {
                    self.repository
                        .record_created(mailbox.id, &provisioned)
                        .await
                        .map_err(internal)?;
                    mailbox.provider_mailbox_id = Some(provisioned.id.clone());
                    mailbox.address = Some(provisioned.address.clone());
                    provisioned
                }
                Err(error) => return self.stop(mailbox, error).await,
            },
        };

        // Before the credential exists, so no send can precede the provider's cap.
        if let Err(error) = self
            .vendor
            .apply_guardrails(&provisioned.id, self.limits.per_hour)
            .await
        {
            return self.stop(mailbox, error).await;
        }

        // The mailbox id is the grant's idempotency key, so a retry within the
        // provider's replay window gets the same credential back.
        let (grant_id, key) = match self
            .vendor
            .grant_access(&provisioned.id, mailbox.id.0)
            .await
        {
            Ok(grant) => grant,
            Err(error) => return self.stop(mailbox, error).await,
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

        let activated = self
            .repository
            .activate(mailbox.id, &grant)
            .await
            .map_err(internal)?;
        if activated {
            mailbox.state = MailboxState::Active;
            mailbox.last_error = None;
            mailbox.grant = Some(grant);
            return Ok(mailbox);
        }

        // Paused or released while this attempt ran: the credential is not
        // needed, and a stored one would outlive the mailbox's decision.
        self.vendor
            .revoke_access(&grant.id)
            .await
            .map_err(mail_error)?;
        self.repository
            .live_mailbox(&mailbox.agent)
            .await
            .map_err(internal)?
            .ok_or(AgentMailboxError::NotFound)
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
        mut mailbox: AgentMailbox,
        error: ProviderError,
    ) -> Result<AgentMailbox, AgentMailboxError> {
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
            .record_failure(mailbox.id, state, failure)
            .await
            .map_err(internal)?;
        mailbox.state = state;
        mailbox.last_error = Some(failure);
        Ok(mailbox)
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

        // A mailbox paused before it was ready goes back to provisioning.
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

    /// Delete the agent's mailbox and its mail at the provider. Safe to repeat;
    /// a failed step leaves it releasing for the sweep.
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
        self.release_mailbox(mailbox, now).await
    }

    async fn release_mailbox(
        &self,
        mailbox: AgentMailbox,
        now: DateTime<Utc>,
    ) -> Result<(), AgentMailboxError> {
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

        if let Some(grant) = &mailbox.grant {
            self.vendor
                .revoke_access(&grant.id)
                .await
                .map_err(mail_error)?;
            self.repository
                .clear_grant(mailbox.id)
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
            .transition(
                mailbox.id,
                &[MailboxState::Releasing],
                MailboxState::Released,
                now,
            )
            .await
            .map_err(internal)?;
        Ok(())
    }

    /// One round of background upkeep: finish stalled provisioning and
    /// releases, and release mailboxes paused longer than [`PAUSED_RETENTION`].
    #[tracing::instrument(skip_all, fields(agent_mailbox.sweep.advanced, agent_mailbox.sweep.failed), err)]
    pub async fn sweep(&self, now: DateTime<Utc>) -> Result<SweepReport, AgentMailboxError> {
        let due = self
            .repository
            .due_for_sweep(
                now - PROVISIONING_RETRY_AFTER,
                now - PAUSED_RETENTION,
                SWEEP_BATCH,
            )
            .await
            .map_err(internal)?;

        let mut report = SweepReport::default();
        for mailbox in due {
            let id = mailbox.id;
            let outcome = match mailbox.state {
                MailboxState::Provisioning => self.advance(mailbox).await.map(|_| ()),
                MailboxState::Releasing | MailboxState::Paused => {
                    self.release_mailbox(mailbox, now).await
                }
                MailboxState::Active | MailboxState::Failed | MailboxState::Released => Ok(()),
            };
            match outcome {
                Ok(()) => report.advanced += 1,
                Err(error) => {
                    tracing::warn!(agent_mailbox.id = %id, error = %error, "agent mailbox sweep step failed");
                    report.failed += 1;
                }
            }
        }

        self.repository
            .prune_sends(now - SEND_RECORD_RETENTION)
            .await
            .map_err(internal)?;

        let span = tracing::Span::current();
        span.record("agent_mailbox.sweep.advanced", report.advanced);
        span.record("agent_mailbox.sweep.failed", report.failed);
        Ok(report)
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

    /// The agent's own mailbox, as the agent sees it.
    pub async fn own_mailbox(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentMailboxView, AgentMailboxError> {
        self.status(agent).await
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
        idempotency_key: Uuid,
        message: OutgoingMessage,
    ) -> Result<SentMessage, AgentMailboxError> {
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
        message: &ProviderMessageId,
        idempotency_key: Uuid,
        reply: ReplyMessage,
    ) -> Result<SentMessage, AgentMailboxError> {
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
    /// provider idempotency key.
    async fn with_reserved_send(
        &self,
        mailbox: &AgentMailbox,
        idempotency_key: Uuid,
        kind: SendKind,
        send: impl AsyncFnOnce() -> Result<SentMessage, ProviderError>,
    ) -> Result<SentMessage, AgentMailboxError> {
        let reservation = self
            .repository
            .reserve_send(mailbox.id, idempotency_key, kind, self.limits, Utc::now())
            .await
            .map_err(internal)?;
        match reservation {
            SendReservation::Proceed => {}
            SendReservation::AlreadySent(sent) => return Ok(sent),
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
