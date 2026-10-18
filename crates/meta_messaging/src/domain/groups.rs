//! WhatsApp group identities and lifecycle facts. Invite links are never part of
//! ordinary conversation metadata; they require a separate posting capability.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::ProviderId;

/// Setup stops being an active dependency after two minutes; saved IDs still correlate.
pub const GROUP_SETUP_TIMEOUT_SECONDS: i32 = 120;
/// Provider subject limit.
pub const GROUP_SUBJECT_MAX_CHARS: usize = 128;

/// Provider destination namespace, independent of an individual author.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaConversationKind))]
#[derive(strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "text", rename_all = "snake_case")
)]
pub enum ConversationKind {
    /// One external person.
    #[default]
    Direct,
    /// A group created through Macro.
    Group,
}

/// Monotonic remote lifecycle; deletion cannot be cleared by a later status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaGroupStatus))]
#[derive(strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "text", rename_all = "snake_case")
)]
pub enum GroupStatus {
    /// External replies are subject to the ordinary group reply window.
    Active,
    /// Meta suspended the group.
    Suspended,
    /// Meta positively confirmed deletion; retained channel is read-only.
    Deleted,
}

/// Creation outcome, including an idempotent response after successful binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaGroupSetupState))]
#[derive(strum::EnumString, strum::Display, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "text", rename_all = "snake_case")
)]
pub enum GroupSetupState {
    /// A signed matching result already bound this request to its group.
    Bound,
    /// No automatic retry is allowed while a server request is in flight.
    Creating,
    /// A request ID was saved; waiting for its signed result.
    Pending,
    /// Meta definitely rejected creation.
    Failed,
    /// An earlier attempt may have left an unused remote group.
    Unknown,
}

/// Public creation result; never contains a speculative remote group ID/link.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaGroupSetup))]
pub struct GroupSetup {
    /// Native identity, reserved before provider I/O.
    pub channel_id: Uuid,
    /// Selected business connection.
    pub connection_id: Uuid,
    /// Native owner's requested subject.
    pub subject: String,
    /// Current creation outcome.
    pub state: GroupSetupState,
    /// Sanitized diagnostic.
    pub error_code: Option<String>,
}

/// Current attempt fence. Internal state is not serialized to channel readers.
pub struct GroupAttempt {
    /// User-visible pending state.
    pub setup: GroupSetup,
    /// Replaced on deliberate retry.
    pub attempt_id: Uuid,
    /// Authorization generation that initiated the attempt.
    pub generation: Option<DateTime<Utc>>,
}

/// Human request to create a private native channel and its WhatsApp group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaCreateGroup))]
pub struct CreateGroup {
    /// Client-retained native identity, also used after a lost HTTP response.
    pub channel_id: Uuid,
    /// WhatsApp subject (1–128 characters).
    pub subject: String,
}

/// Provider result for one create, never automatically repeated.
pub enum GroupCreateResult {
    /// Persist before accepting the matching lifecycle callback.
    Pending(ProviderId),
    /// Definitive rejection, sanitized code only.
    Rejected(String),
    /// Transport loss, server failure or malformed success.
    Unknown,
}

/// Confirmed external participant, independent of native teammate membership.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaGroupParticipant))]
pub struct GroupParticipant {
    /// Stable native external author across departure and identity updates.
    pub external_sender_id: Uuid,
    /// Current scoped BSUID or legacy phone.
    pub customer_id: ProviderId,
    /// Optional provider display name.
    pub display_name: Option<String>,
    /// Optional mutable username.
    pub username: Option<String>,
    /// Separately supplied phone.
    pub phone: Option<String>,
}

/// Restricted group controls and participants; invite link is fetched separately.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaGroupView))]
pub struct GroupView {
    /// Native identity.
    pub channel_id: Uuid,
    /// Present until a signed matching create result binds the group.
    pub setup: Option<GroupSetup>,
    /// Authoritative remote availability after binding.
    pub status: Option<GroupStatus>,
    /// Confirmed current participants.
    pub participants: Vec<GroupParticipant>,
    /// Current connector and owner may deliberately retry creation.
    pub can_retry: bool,
    /// Native posting permission and business team membership.
    pub can_copy_link: bool,
    /// Native participant admin permission and team membership.
    pub can_remove: bool,
    /// Native ownership and business team membership.
    pub can_delete: bool,
}

/// Link returned only through the explicit authorized operation.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaGroupInviteLink))]
pub struct GroupInviteLink {
    /// Validated Meta invite URL.
    pub invite_link: String,
}

/// Individual membership fact, including successful siblings of partial failures.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaParticipantFact))]
pub struct ParticipantFact {
    /// Preferred BSUID or removal input.
    pub customer_id: ProviderId,
    /// Phone independently supplied for this person.
    pub phone: Option<ProviderId>,
    /// Provider name, if supplied.
    pub display_name: Option<String>,
    /// Mutable username.
    pub username: Option<String>,
    /// Confirmed membership.
    pub active: bool,
}

/// One independently decoded, signed group fact.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaGroupEvent))]
pub struct GroupEvent {
    /// Receiving business phone number.
    pub account_id: ProviderId,
    /// Provider observation time, used for ordering only.
    pub timestamp: DateTime<Utc>,
    /// Exact fact, never a local action request.
    pub fact: GroupFact,
}

/// Supported group metadata events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaGroupFact))]
pub enum GroupFact {
    /// Completion of one specific attempt.
    Created {
        /// Exact create response correlation ID.
        request_id: ProviderId,
        /// Only present on successful creation.
        group_id: Option<ProviderId>,
        /// Canonical subject on successful creation.
        subject: Option<String>,
        /// Authoritative link, only retained for the current bound attempt.
        invite_link: Option<String>,
        /// Sanitized rejection if creation failed.
        error_code: Option<String>,
    },
    /// Positive remote deletion (error-bearing notifications are excluded).
    Deleted {
        /// Known group identity.
        group_id: ProviderId,
    },
    /// One confirmed participant transition.
    Participant {
        /// Group destination, never a person alias.
        group_id: ProviderId,
        /// Individual fact.
        participant: ParticipantFact,
    },
    /// Successfully changed subject.
    Subject {
        /// Known group identity.
        group_id: ProviderId,
        /// Provider-owned channel name.
        subject: String,
    },
    /// Suspension or a newer authoritative clearance.
    Status {
        /// Known group identity.
        group_id: ProviderId,
        /// Active or suspended; deletion uses the separate terminal event.
        status: GroupStatus,
    },
}

#[cfg(feature = "ports")]
pub mod ports;
