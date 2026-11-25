//! Domain models for agent mailboxes.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;
use zeroize::Zeroizing;

/// Macro's id for an agent's mailbox, also sent to the provider as the owner tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(transparent))]
pub struct AgentMailboxId(pub Uuid);

impl AgentMailboxId {
    /// A new time-ordered id.
    #[must_use]
    pub fn generate() -> Self {
        Self(Uuid::now_v7())
    }
}

impl std::fmt::Display for AgentMailboxId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The team an agent account belongs to; caps that span mailboxes count per team.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TeamId(pub Uuid);

impl std::fmt::Display for TeamId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The provider's id for a mailbox.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct ProviderMailboxId(pub String);

/// The provider's id for one message, as an agent or the provider names it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(transparent))]
pub struct ProviderMessageId(pub String);

/// A message id that is not one a provider would issue.
#[derive(Debug, thiserror::Error)]
#[error("a message id is 1 to 128 letters, digits, '.', '_', ':' or '-'")]
pub struct InvalidMessageId;

impl ProviderMessageId {
    /// Accept a message id a caller passed, checking its shape.
    pub fn parse(value: &str) -> Result<Self, InvalidMessageId> {
        if lazy_regex::regex_is_match!(r"\A[A-Za-z0-9._:-]{1,128}\z", value) {
            Ok(Self(value.to_owned()))
        } else {
            Err(InvalidMessageId)
        }
    }
}

/// The provider's id for the mailbox-scoped credential Macro holds.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ProviderGrantId(pub String);

/// Which provider hosts a mailbox.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "snake_case"))]
pub enum MailboxProvider {
    /// deadsimple.email, a temporary mailbox host.
    DeadSimple,
}

/// Where a mailbox is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "snake_case"))]
pub enum MailboxState {
    /// Being created at the provider; a retry or the sweep finishes it.
    Provisioning,
    /// Ready: the agent can read and send.
    Active,
    /// Creation stopped on an error a retry of the same request may clear.
    Failed,
    /// Kept with its mail, but the agent can neither read nor send.
    Paused,
    /// Being deleted at the provider; the sweep finishes it.
    Releasing,
    /// Deleted at the provider. Terminal.
    Released,
}

/// Why provisioning stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "snake_case"))]
pub enum ProvisioningFailure {
    /// No provider credentials are configured, or the provider refused them.
    NotConfigured,
    /// The address and its suffixed fallback are both taken.
    AddressTaken,
    /// The provider account has no room for another mailbox.
    QuotaExceeded,
    /// The provider refused the request as invalid.
    Rejected,
    /// The provider was unreachable or throttled; it is retried.
    Unavailable,
}

/// A validated mailbox local part: lowercase ASCII letters, digits, `.` and `-`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalPart(String);

/// Role and staff names no agent may take: RFC 2142 roles, the addresses a
/// certificate authority mails to prove control of a domain, and names that
/// would pass for Macro staff.
pub const RESERVED_LOCAL_PARTS: &[&str] = &[
    "abuse",
    "admin",
    "administrator",
    "billing",
    "help",
    "helpdesk",
    "hostmaster",
    "info",
    "legal",
    "mailer-daemon",
    "marketing",
    "no-reply",
    "noc",
    "noreply",
    "postmaster",
    "privacy",
    "root",
    "sales",
    "security",
    "ssladmin",
    "ssl-admin",
    "support",
    "sysadmin",
    "team",
    "usenet",
    "uucp",
    "webmaster",
    "www",
];

/// The longest local part Macro asks for, leaving room for a suffix.
pub const MAX_LOCAL_PART_LENGTH: usize = 40;

/// A local part that cannot be used.
#[derive(Debug, thiserror::Error)]
#[error("a mailbox name uses lowercase letters, digits, '.' and '-', at most 40 characters")]
pub struct InvalidLocalPart;

impl LocalPart {
    /// Accept a local part exactly as given.
    pub fn parse(value: &str) -> Result<Self, InvalidLocalPart> {
        let valid_characters = value.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '.'
                || character == '-'
        });
        let edges_are_alphanumeric =
            value
                .chars()
                .next()
                .zip(value.chars().last())
                .is_some_and(|(first, last)| {
                    first.is_ascii_alphanumeric() && last.is_ascii_alphanumeric()
                });

        if value.is_empty()
            || value.len() > MAX_LOCAL_PART_LENGTH
            || !valid_characters
            || !edges_are_alphanumeric
            || value.contains("..")
        {
            return Err(InvalidLocalPart);
        }
        Ok(Self(value.to_owned()))
    }

    /// Whether this is a role or staff name no agent may take as is; a new
    /// mailbox asking for one gets the suffixed form. Checked only when a
    /// mailbox is created, so a name added to the list later never makes a
    /// stored row unreadable.
    #[must_use]
    pub fn is_reserved(&self) -> bool {
        RESERVED_LOCAL_PARTS.contains(&self.0.as_str())
    }

    /// The same local part with a short suffix from the mailbox id, for when it is taken.
    #[must_use]
    pub fn with_suffix(&self, mailbox: AgentMailboxId) -> Self {
        let suffix: String = mailbox
            .0
            .simple()
            .to_string()
            .chars()
            .rev()
            .take(4)
            .collect();
        let base: String = self.0.chars().take(MAX_LOCAL_PART_LENGTH - 5).collect();
        let base = base.trim_end_matches(['.', '-']);
        Self(format!("{base}-{suffix}"))
    }

    /// The local part as text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An agent's mailbox as Macro records it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentMailbox {
    /// Macro's id.
    pub id: AgentMailboxId,
    /// The caller's id for the request that created it.
    pub request_id: Uuid,
    /// The agent's own Macro account, which alone may use the mailbox.
    pub agent: MacroUserIdStr<'static>,
    /// The agent's team when the mailbox was made.
    pub team: TeamId,
    /// Who hosts it.
    pub provider: MailboxProvider,
    /// The local part Macro asked for.
    pub requested_local_part: Option<LocalPart>,
    /// The display name Macro asked for.
    pub display_name: Option<String>,
    /// The provider's mailbox, once created.
    pub provider_mailbox_id: Option<ProviderMailboxId>,
    /// The address, once created.
    pub address: Option<String>,
    /// The mailbox-scoped credential, once minted.
    pub grant: Option<StoredGrant>,
    /// Where it is in its life.
    pub state: MailboxState,
    /// Why provisioning last stopped.
    pub last_error: Option<ProvisioningFailure>,
    /// When it was paused.
    pub paused_at: Option<DateTime<Utc>>,
}

/// The mailbox-scoped credential as stored: KMS ciphertext only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredGrant {
    /// The provider's id for the credential, to revoke it.
    pub id: ProviderGrantId,
    /// The credential, encrypted.
    pub key: EncryptedMailboxKey,
}

/// A mailbox credential encrypted under KMS, bound to its mailbox and agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedMailboxKey {
    /// The KMS ciphertext.
    pub ciphertext: Vec<u8>,
    /// The KMS key that encrypted it.
    pub kms_key_id: String,
    /// The scheme that produced it.
    pub encryption_version: i16,
}

/// A mailbox credential in plaintext. Redacts `Debug`, zeroizes on drop, and
/// is only ever turned into one request's authorization header.
pub struct MailboxKey(Zeroizing<String>);

impl MailboxKey {
    /// Wrap a credential.
    #[must_use]
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    /// The plaintext, for the transport that authenticates with it only.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for MailboxKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MailboxKey(redacted)")
    }
}

/// A request to give an agent a mailbox.
#[derive(Clone, Debug)]
pub struct ProvisionRequest {
    /// The caller's retry-stable id; one request gives one mailbox.
    pub request_id: Uuid,
    /// The agent's own Macro account.
    pub agent: MacroUserIdStr<'static>,
    /// Shown as the sender's name.
    pub display_name: Option<String>,
    /// The local part to ask for; the provider picks one when absent.
    pub requested_local_part: Option<LocalPart>,
}

/// What `reserve` found or made for a provision request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reservation {
    /// A new mailbox row for this request.
    New(AgentMailbox),
    /// The row an earlier attempt of this request made.
    Existing(AgentMailbox),
    /// The agent already has a live mailbox from a different request.
    AgentHasMailbox(AgentMailbox),
    /// The team already has its most live mailboxes.
    TeamFull,
}

/// A mailbox the provider created.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProvisionedMailbox {
    /// The provider's id.
    pub id: ProviderMailboxId,
    /// Its address.
    pub address: String,
}

/// What Macro asks a provider to create.
#[derive(Clone, Debug)]
pub struct CreateMailbox {
    /// Replays of the same key return the same mailbox.
    pub idempotency_key: Uuid,
    /// Macro's id, stored as a tag so a lost create can be found again.
    pub owner_tag: AgentMailboxId,
    /// The local part to ask for.
    pub local_part: Option<LocalPart>,
    /// The sender's display name.
    pub display_name: Option<String>,
}

/// Whether a message came in or went out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString, strum::Display)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "snake_case"))]
pub enum MessageDirection {
    /// Received by the mailbox.
    Inbound,
    /// Sent from the mailbox.
    Outbound,
}

/// One message as the provider returned it. Its content is untrusted data:
/// nothing in it authorizes anything.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "camelCase"))]
pub struct MailMessage {
    /// The provider's id.
    pub id: ProviderMessageId,
    /// The mailbox the provider says holds it; checked against the agent's own.
    #[cfg_attr(feature = "wire", serde(skip))]
    pub mailbox: ProviderMailboxId,
    /// The conversation it belongs to.
    pub thread_id: Option<String>,
    /// In or out.
    pub direction: MessageDirection,
    /// Sender address.
    pub from: String,
    /// Recipient addresses.
    pub to: Vec<String>,
    /// Copied addresses.
    pub cc: Vec<String>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body, when the provider returned one.
    pub text_body: Option<String>,
    /// When the provider recorded it.
    pub created_at: Option<DateTime<Utc>>,
}

/// Which page of messages to list.
#[derive(Clone, Debug, Default)]
pub struct MessagePage {
    /// The provider's cursor from the previous page.
    pub cursor: Option<String>,
    /// At most this many, 1 to 50.
    pub limit: Option<u8>,
}

/// One page of messages.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "camelCase"))]
pub struct MessageList {
    /// Newest first.
    pub messages: Vec<MailMessage>,
    /// The cursor for the next page.
    pub next_cursor: Option<String>,
}

/// A new message from the agent.
#[derive(Clone, Debug)]
pub struct OutgoingMessage {
    /// Recipients, 1 to 20.
    pub to: Vec<String>,
    /// Copied recipients.
    pub cc: Vec<String>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text_body: String,
}

/// A reply to a message in the agent's mailbox.
#[derive(Clone, Debug)]
pub struct ReplyMessage {
    /// Plain-text body.
    pub text_body: String,
}

/// A message the provider accepted for delivery.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "camelCase"))]
pub struct SentMessage {
    /// The provider's id for it.
    pub id: ProviderMessageId,
    /// Its conversation.
    pub thread_id: Option<String>,
}

/// Whether a send is a new message or a reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SendKind {
    /// A new message.
    Message,
    /// A reply.
    Reply,
}

/// One send as the ledger records it: what it is, never what it says.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SendAttempt {
    /// The agent's idempotency key.
    pub idempotency_key: Uuid,
    /// A new message or a reply.
    pub kind: SendKind,
    /// Recipients, `to` and `cc` together; a reply counts one.
    pub recipient_count: u32,
    /// A digest of everything the send says (kind, target, recipients,
    /// subject, body), so one key can't be reused for a different message.
    pub fingerprint: [u8; 32],
}

/// What `reserve_send` decided.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SendReservation {
    /// Go ahead. `fresh` when this attempt made the reservation; otherwise it
    /// retries one whose outcome is unknown, still inside the provider's
    /// idempotency replay window, and must leave that reservation in place
    /// whatever the provider answers.
    Proceed {
        /// This attempt made the reservation.
        fresh: bool,
    },
    /// The key was already used for a different message.
    KeyReused,
    /// The mailbox stopped being active (paused or released) after the
    /// caller read it; nothing was reserved.
    NotActive(MailboxState),
    /// An earlier attempt with this key may have been sent, and the provider
    /// no longer dedupes it: sending again could send twice.
    OutcomeUnknown,
    /// The same idempotency key already sent this.
    AlreadySent(SentMessage),
    /// A cap is full until `retry_at`.
    LimitReached {
        /// When the oldest counted send leaves the window.
        retry_at: DateTime<Utc>,
    },
}

/// A background job one replica runs per interval for the whole cluster.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SweepJob {
    /// Pausing mailboxes whose agent account or team is gone.
    Orphans,
    /// Deleting send records past their retention.
    Prune,
}

/// Send caps, counting sends accepted or in flight.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SendLimits {
    /// Messages per mailbox per rolling hour.
    pub per_hour: u32,
    /// Messages per mailbox per rolling 24 hours.
    pub per_day: u32,
    /// Recipients per mailbox per rolling 24 hours.
    pub recipients_per_day: u32,
    /// Recipients across all of a team's agent mailboxes per rolling 24 hours.
    pub team_recipients_per_day: u32,
}

impl SendLimits {
    /// The caps v1 ships with: per mailbox 10 messages an hour, 40 a day and
    /// 100 recipients a day; per team 300 recipients a day.
    pub const DEFAULT: Self = Self {
        per_hour: 10,
        per_day: 40,
        recipients_per_day: 100,
        team_recipients_per_day: 300,
    };
}

/// Whether the provider behind this deployment is real.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "snake_case"))]
pub enum VendorMode {
    /// The provider's production API.
    Live,
    /// A local fake standing in for the provider: no real mail moves.
    Fake,
}

/// The owner's approval of one send, quoted. Every mailbox belongs to an
/// agent account, so every send or reply from one needs it, whatever
/// credential the agent calls with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnerApproval(pub Option<String>);

/// What callers see about a mailbox. No credentials.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "wire", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "wire", serde(rename_all = "camelCase"))]
pub struct AgentMailboxView {
    /// Macro's id.
    pub id: AgentMailboxId,
    /// The address, once created.
    pub address: Option<String>,
    /// Where it is in its life.
    pub state: MailboxState,
    /// Why provisioning last stopped.
    pub last_error: Option<ProvisioningFailure>,
    /// Who hosts it.
    pub provider: MailboxProvider,
    /// Whether that provider is real.
    pub vendor_mode: VendorMode,
}

/// What can go wrong for a caller of the service.
#[derive(Debug, thiserror::Error)]
pub enum AgentMailboxError {
    /// The caller has no mailbox, or the message is not in its mailbox.
    #[error("not found")]
    NotFound,
    /// Mailboxes are only for agent accounts.
    #[error("only an agent account on a team can have a mailbox")]
    NotAnAgent,
    /// The agent already has a mailbox from another request.
    #[error("this agent already has a mailbox")]
    AlreadyProvisioned,
    /// The agent's team has its most live mailboxes.
    #[error("this team has reached its agent mailbox limit")]
    TeamLimit,
    /// The mailbox is paused.
    #[error("this mailbox is paused")]
    Paused,
    /// The mailbox is not ready yet, or creating it failed.
    #[error("this mailbox is not ready ({0})")]
    NotReady(MailboxState),
    /// A send cap is full.
    #[error("send limit reached; try again after {retry_at}")]
    SendLimit {
        /// When a send fits again.
        retry_at: DateTime<Utc>,
    },
    /// The request is malformed.
    #[error("{0}")]
    Invalid(String),
    /// A send or reply without its owner's quoted approval.
    #[error(
        "an agent cannot send email without its owner's approval; ask the owner, and send again with their reply quoted in `confirmation`"
    )]
    ConfirmationRequired,
    /// An earlier send with this key may have gone out and can no longer be
    /// deduplicated: check the sent mail before sending again with a new key.
    #[error(
        "an earlier send with this idempotency key may have been delivered; check the sent messages before sending again with a new key"
    )]
    SendOutcomeUnknown,
    /// Another operation on this mailbox is running; it finishes on its own.
    #[error("another operation on this mailbox is in progress; it finishes on its own")]
    Busy,
    /// The provider has no credentials or refused them.
    #[error("the mail provider is not configured")]
    NotConfigured,
    /// The provider refused the request.
    #[error("the mail provider refused the request")]
    Rejected,
    /// The provider is unreachable or throttled; the same request can be retried.
    #[error("the mail provider is unavailable; retry with the same idempotency key")]
    Unavailable,
    /// Something Macro-side failed.
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for AgentMailboxError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}
