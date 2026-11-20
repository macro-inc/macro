//! Ports the agent mailbox service needs.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    AgentMailbox, AgentMailboxId, CreateMailbox, EncryptedMailboxKey, MailMessage, MailboxKey,
    MailboxState, MessageList, MessagePage, OutgoingMessage, ProviderGrantId, ProviderMailboxId,
    ProviderMessageId, ProvisionRequest, ProvisionedMailbox, ProvisioningFailure, ReplyMessage,
    Reservation, SendKind, SendLimits, SendReservation, SentMessage, StoredGrant,
};

/// How a provider call failed, in the terms the service decides on.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    /// No usable credentials: missing, revoked, or the provider asked for payment.
    #[error("provider credentials are missing or refused")]
    NotConfigured,
    /// The requested address is taken.
    #[error("address taken")]
    AddressTaken,
    /// The provider account has no room for another mailbox.
    #[error("provider quota exceeded")]
    QuotaExceeded,
    /// The provider's own send limit is full.
    #[error("provider send limit reached")]
    SendLimit,
    /// The thing named does not exist, or is not visible to this credential.
    #[error("not found at the provider")]
    NotFound,
    /// The provider refused the request as invalid.
    #[error("provider rejected the request")]
    Rejected,
    /// The provider asked to slow down; nothing was done.
    #[error("provider throttled the request")]
    Throttled,
    /// The provider could not be reached or failed; the outcome is unknown.
    #[error("provider unavailable")]
    Unavailable,
}

/// Administrative provider operations. Holds the provisioning credential,
/// which never leaves the server and is never used to read or send mail.
pub trait MailboxProvisioner: Send + Sync + 'static {
    /// Create a mailbox. Replaying the same idempotency key returns the same one.
    fn create_mailbox(
        &self,
        request: &CreateMailbox,
    ) -> impl Future<Output = Result<ProvisionedMailbox, ProviderError>> + Send;

    /// The mailbox an earlier, possibly lost, create made for this owner tag.
    fn find_mailbox(
        &self,
        owner_tag: AgentMailboxId,
    ) -> impl Future<Output = Result<Option<ProvisionedMailbox>, ProviderError>> + Send;

    /// Mint a credential that can read and send for this one mailbox only.
    fn grant_access(
        &self,
        mailbox: &ProviderMailboxId,
        idempotency_key: Uuid,
    ) -> impl Future<Output = Result<(ProviderGrantId, MailboxKey), ProviderError>> + Send;

    /// Revoke a mailbox credential. Revoking one already gone succeeds.
    fn revoke_access(
        &self,
        grant: &ProviderGrantId,
    ) -> impl Future<Output = Result<(), ProviderError>> + Send;

    /// Delete a mailbox and its mail. Deleting one already gone succeeds.
    fn delete_mailbox(
        &self,
        mailbox: &ProviderMailboxId,
    ) -> impl Future<Output = Result<(), ProviderError>> + Send;
}

/// Mail operations, each authenticated with one mailbox's own credential.
pub trait MailboxClient: Send + Sync + 'static {
    /// One page of messages, newest first.
    fn list_messages(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        page: &MessagePage,
    ) -> impl Future<Output = Result<MessageList, ProviderError>> + Send;

    /// One message with its body.
    fn read_message(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        message: &ProviderMessageId,
    ) -> impl Future<Output = Result<MailMessage, ProviderError>> + Send;

    /// Send a new message. Replaying the idempotency key sends nothing new.
    fn send(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        message: &OutgoingMessage,
        idempotency_key: Uuid,
    ) -> impl Future<Output = Result<SentMessage, ProviderError>> + Send;

    /// Reply to a message. Replaying the idempotency key sends nothing new.
    fn reply(
        &self,
        mailbox: &ProviderMailboxId,
        key: &MailboxKey,
        message: &ProviderMessageId,
        reply: &ReplyMessage,
        idempotency_key: Uuid,
    ) -> impl Future<Output = Result<SentMessage, ProviderError>> + Send;
}

/// Encrypts mailbox credentials so only this mailbox and agent decrypt them.
pub trait MailboxKeyCipher: Send + Sync + 'static {
    /// The error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Encrypt, bound to the mailbox and its agent.
    fn encrypt(
        &self,
        mailbox: AgentMailboxId,
        agent: &MacroUserIdStr<'_>,
        key: &MailboxKey,
    ) -> impl Future<Output = Result<EncryptedMailboxKey, Self::Err>> + Send;

    /// Decrypt; fails for any other mailbox or agent.
    fn decrypt(
        &self,
        mailbox: AgentMailboxId,
        agent: &MacroUserIdStr<'_>,
        key: &EncryptedMailboxKey,
    ) -> impl Future<Output = Result<MailboxKey, Self::Err>> + Send;
}

/// Facts about Macro accounts.
pub trait AgentDirectory: Send + Sync + 'static {
    /// The error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Whether this account is an agent's.
    fn is_agent(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Mailbox rows and the send ledger.
pub trait AgentMailboxRepository: Send + Sync + 'static {
    /// The error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Find the row for this request, or create one with `id` when the agent has
    /// no live mailbox.
    fn reserve(
        &self,
        request: &ProvisionRequest,
        id: AgentMailboxId,
    ) -> impl Future<Output = Result<Reservation, Self::Err>> + Send;

    /// The agent's mailbox that is not released.
    fn live_mailbox(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<AgentMailbox>, Self::Err>> + Send;

    /// Record the provider's mailbox.
    fn record_created(
        &self,
        id: AgentMailboxId,
        mailbox: &ProvisionedMailbox,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record the credential and make the mailbox active, unless it left
    /// provisioning meanwhile. Returns whether it became active.
    fn activate(
        &self,
        id: AgentMailboxId,
        grant: &StoredGrant,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Record why provisioning stopped, leaving it in `state`
    /// (`Provisioning` to retry, `Failed` to stop).
    fn record_failure(
        &self,
        id: AgentMailboxId,
        state: MailboxState,
        failure: ProvisioningFailure,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Move from one of `from` to `to`. Returns whether it moved.
    fn transition(
        &self,
        id: AgentMailboxId,
        from: &[MailboxState],
        to: MailboxState,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Forget the credential once the provider revoked it.
    fn clear_grant(&self, id: AgentMailboxId)
    -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Mailboxes the sweep should move on: provisioning since before
    /// `stalled_before`, releasing, or paused since before `paused_before`.
    fn due_for_sweep(
        &self,
        stalled_before: DateTime<Utc>,
        paused_before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<AgentMailbox>, Self::Err>> + Send;

    /// Count a send against the caps, or find it already sent. A retry of a
    /// send whose outcome is unknown proceeds without counting twice.
    fn reserve_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
        kind: SendKind,
        limits: SendLimits,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<SendReservation, Self::Err>> + Send;

    /// Record the provider's acceptance of a reserved send.
    fn complete_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
        sent: &SentMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Drop a reserved send the provider definitely did not accept, freeing its slot.
    fn cancel_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
