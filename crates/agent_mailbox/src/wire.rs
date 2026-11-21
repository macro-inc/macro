//! Request and response bodies of the agent mailbox routes, shared by the
//! routes and their clients.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::{AgentMailboxError, AgentMailboxView, VendorMode};

/// Shown with every mailbox a fake provider serves, so nobody mistakes it for real mail.
pub const FAKE_VENDOR_NOTICE: &str = "fake vendor, not live";

/// Why a request was refused, stable for callers to match on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, strum::Display)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentMailboxErrorCode {
    /// No mailbox, or the message is not in it. `404`.
    NotFound,
    /// Only agent accounts on a team get mailboxes. `403`.
    NotAnAgent,
    /// The agent has a mailbox from another request. `409`.
    AlreadyProvisioned,
    /// The agent's team has its most live mailboxes. `409`.
    TeamLimit,
    /// The mailbox is paused. `409`.
    Paused,
    /// The mailbox is not ready, or creating it failed. `409`.
    NotReady,
    /// A send cap is full; see `retryAt`. `429`.
    SendLimit,
    /// A malformed request. `400`.
    Invalid,
    /// A send or reply without the owner's quoted approval. `403`.
    ConfirmationRequired,
    /// No provider is configured. `503`.
    NotConfigured,
    /// An earlier send with this key may have gone out and can no longer be
    /// deduplicated; check the sent mail before sending with a new key. `409`.
    SendOutcomeUnknown,
    /// Another operation on this mailbox is running and finishes on its own. `503`.
    Busy,
    /// The provider refused the request. `502`.
    ProviderRejected,
    /// The provider is unavailable; retry with the same key. `503`.
    ProviderUnavailable,
    /// Macro failed. `500`.
    Internal,
}

impl AgentMailboxErrorCode {
    /// The code for a service error.
    #[must_use]
    pub fn of(error: &AgentMailboxError) -> Self {
        match error {
            AgentMailboxError::NotFound => Self::NotFound,
            AgentMailboxError::NotAnAgent => Self::NotAnAgent,
            AgentMailboxError::AlreadyProvisioned => Self::AlreadyProvisioned,
            AgentMailboxError::TeamLimit => Self::TeamLimit,
            AgentMailboxError::Paused => Self::Paused,
            AgentMailboxError::NotReady(_) => Self::NotReady,
            AgentMailboxError::SendLimit { .. } => Self::SendLimit,
            AgentMailboxError::Invalid(_) => Self::Invalid,
            AgentMailboxError::ConfirmationRequired => Self::ConfirmationRequired,
            AgentMailboxError::SendOutcomeUnknown => Self::SendOutcomeUnknown,
            AgentMailboxError::Busy => Self::Busy,
            AgentMailboxError::NotConfigured => Self::NotConfigured,
            AgentMailboxError::Rejected => Self::ProviderRejected,
            AgentMailboxError::Unavailable => Self::ProviderUnavailable,
            AgentMailboxError::Internal(_) => Self::Internal,
        }
    }
}

/// An error answer.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentMailboxErrorBody {
    /// Why.
    pub code: AgentMailboxErrorCode,
    /// What happened, for the agent or person reading it.
    pub message: String,
    /// For `send_limit`: when a send fits again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_at: Option<DateTime<Utc>>,
}

/// A mailbox as callers see it, with the fake-provider notice when there is one.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentMailboxResponse {
    /// The mailbox.
    #[serde(flatten)]
    pub mailbox: AgentMailboxView,
    /// `"fake vendor, not live"` when a fake provider serves this deployment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

impl From<AgentMailboxView> for AgentMailboxResponse {
    fn from(mailbox: AgentMailboxView) -> Self {
        let notice = match mailbox.vendor_mode {
            VendorMode::Live => None,
            VendorMode::Fake => Some(FAKE_VENDOR_NOTICE.to_owned()),
        };
        Self { mailbox, notice }
    }
}

/// A new message from the agent's mailbox.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SendAgentMessageRequest {
    /// Retry-stable: repeating a send with the same key sends once.
    pub idempotency_key: Uuid,
    /// Recipients, 1 to 20 with `cc`.
    pub to: Vec<String>,
    /// Copied recipients.
    #[serde(default)]
    pub cc: Vec<String>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text_body: String,
    /// The owner's approval, quoted. Required on every send and reply.
    #[serde(default)]
    pub confirmation: Option<String>,
}

/// A reply from the agent's mailbox.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ReplyAgentMessageRequest {
    /// Retry-stable: repeating a reply with the same key sends once.
    pub idempotency_key: Uuid,
    /// Plain-text body.
    pub text_body: String,
    /// The owner's approval, quoted. Required on every send and reply.
    #[serde(default)]
    pub confirmation: Option<String>,
}

/// A request to give an agent a mailbox.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ProvisionAgentMailboxRequest {
    /// Retry-stable: one request makes at most one mailbox.
    pub request_id: Uuid,
    /// The agent's own Macro account.
    pub agent_user_id: String,
    /// Shown as the sender's name.
    #[serde(default)]
    pub display_name: Option<String>,
    /// The local part to ask for: lowercase letters, digits, `.` and `-`.
    #[serde(default)]
    pub requested_local_part: Option<String>,
}
