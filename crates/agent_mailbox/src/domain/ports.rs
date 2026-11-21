//! Ports the agent mailbox service needs.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    AgentMailbox, AgentMailboxId, CreateMailbox, EncryptedMailboxKey, MailMessage, MailboxKey,
    MailboxState, MessageList, MessagePage, OutgoingMessage, ProviderGrantId, ProviderMailboxId,
    ProviderMessageId, ProvisionRequest, ProvisionedMailbox, ProvisioningFailure, ReplyMessage,
    Reservation, SendAttempt, SendLimits, SendReservation, SentMessage, StoredGrant, TeamId,
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

    /// Set the provider's own send cap on a mailbox, behind Macro's. Repeatable.
    fn apply_guardrails(
        &self,
        mailbox: &ProviderMailboxId,
        max_sends_per_hour: u32,
    ) -> impl Future<Output = Result<(), ProviderError>> + Send;

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

    /// Revoke every credential scoped to this mailbox, stored or not.
    fn revoke_all_access(
        &self,
        mailbox: &ProviderMailboxId,
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

    /// The team of this account when it is an agent's and on a team; `None`
    /// for anyone else.
    fn agent_team(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamId>, Self::Err>> + Send;
}

/// A claim on one mailbox's provider-side operations, held by one attempt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LeaseToken(pub Uuid);

/// Mailbox rows and the send ledger.
///
/// Provider-side steps (create, scope a key, revoke, delete) run under a
/// lease: [`claim`](Self::claim) hands one attempt a token, and every write
/// that records a provider step names it, so an attempt whose lease another
/// took over writes nothing. State flips by the caller (pause, resume,
/// start of a release) need no lease and win over a running attempt.
pub trait AgentMailboxRepository: Send + Sync + 'static {
    /// The error type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Find the row for this request, or create one with `id` for `team` when
    /// the agent has no live mailbox and the team has fewer than
    /// `team_mailbox_limit` live ones.
    fn reserve(
        &self,
        request: &ProvisionRequest,
        id: AgentMailboxId,
        team: TeamId,
        team_mailbox_limit: u32,
    ) -> impl Future<Output = Result<Reservation, Self::Err>> + Send;

    /// One mailbox by id, in any state.
    fn mailbox(
        &self,
        id: AgentMailboxId,
    ) -> impl Future<Output = Result<Option<AgentMailbox>, Self::Err>> + Send;

    /// The agent's mailbox that is not released.
    fn live_mailbox(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<AgentMailbox>, Self::Err>> + Send;

    /// Take the mailbox's lease until `now + ttl` unless another attempt holds
    /// an unexpired one, returning the row as it stands under the lease.
    fn claim(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        now: DateTime<Utc>,
        ttl: chrono::Duration,
    ) -> impl Future<Output = Result<Option<AgentMailbox>, Self::Err>> + Send;

    /// Give the lease back.
    fn unclaim(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record the provider's mailbox, in any state but released, so a release
    /// that started meanwhile still deletes it. False when the lease is lost.
    fn record_created(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        mailbox: &ProvisionedMailbox,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Record the scoped credential, in any state but released. False when
    /// the lease is lost.
    fn record_grant(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        grant: &StoredGrant,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Make a provisioning (or failed) mailbox with a credential active.
    /// False when it left provisioning meanwhile or the lease is lost.
    fn activate(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Record why provisioning stopped, leaving it in `state` (`Provisioning`
    /// to retry, `Failed` to stop), unless it left provisioning meanwhile.
    fn record_failure(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
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

    /// Start releasing a mailbox only if it is still paused, and was paused
    /// before `paused_before`. Returns whether it started.
    fn release_if_paused_before(
        &self,
        id: AgentMailboxId,
        paused_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Forget the credential once the provider revoked it.
    fn clear_grant(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Mark a releasing mailbox released. Returns whether it did.
    fn finish_release(
        &self,
        id: AgentMailboxId,
        token: LeaseToken,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Mailboxes the sweep should move on: provisioning since before
    /// `stalled_before`, releasing, or paused since before `paused_before`,
    /// leaving out those deferred past `now`.
    fn due_for_sweep(
        &self,
        now: DateTime<Utc>,
        stalled_before: DateTime<Utc>,
        paused_before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<AgentMailbox>, Self::Err>> + Send;

    /// Keep the sweep off this mailbox until `until`, after a failed step.
    fn defer_sweep(
        &self,
        id: AgentMailboxId,
        until: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Count a send against the mailbox's and its team's caps, or find it
    /// already sent, and open its audit record. A key reused with a different
    /// fingerprint is `KeyReused`. A retry of a send whose outcome is unknown
    /// proceeds (not fresh) without counting twice while it started after
    /// `replayable_since`, and is refused as unknown after.
    fn reserve_send(
        &self,
        mailbox: &AgentMailbox,
        attempt: &SendAttempt,
        limits: SendLimits,
        now: DateTime<Utc>,
        replayable_since: DateTime<Utc>,
    ) -> impl Future<Output = Result<SendReservation, Self::Err>> + Send;

    /// Record the provider's acceptance of a reserved send, in the ledger and
    /// its audit record.
    fn complete_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
        sent: &SentMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Drop a fresh reservation the provider definitely did not accept,
    /// freeing its slot; its audit record stays, marked refused.
    fn cancel_send(
        &self,
        mailbox: AgentMailboxId,
        idempotency_key: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete up to [`PRUNE_BATCH`](crate::domain::service::PRUNE_BATCH) send
    /// records created before `before`, oldest first; they no longer count
    /// toward a cap or dedupe a retry. Returns how many went.
    fn prune_sends(
        &self,
        before: DateTime<Utc>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Delete up to [`PRUNE_BATCH`](crate::domain::service::PRUNE_BATCH) send
    /// audit records created before `before`. Returns how many went.
    fn prune_send_audit(
        &self,
        before: DateTime<Utc>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Of the next `page` provisioning, active or failed mailboxes by id
    /// after `after`, those whose agent account is gone, is no longer an
    /// agent's, or is no longer on the mailbox's team (or the team is gone).
    /// Returns them with the last id read, `None` once there are no more.
    fn orphaned(
        &self,
        after: Option<AgentMailboxId>,
        page: u16,
    ) -> impl Future<Output = Result<(Vec<AgentMailbox>, Option<AgentMailboxId>), Self::Err>> + Send;

    /// Pause a provisioning, active or failed mailbox only if it is still an
    /// orphan, rechecked in the same write. Returns whether it paused.
    fn pause_if_orphaned(
        &self,
        id: AgentMailboxId,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Take this round of the orphan check for the whole cluster: true for
    /// exactly one caller per `every`.
    fn claim_orphan_check(
        &self,
        now: DateTime<Utc>,
        every: chrono::Duration,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}
