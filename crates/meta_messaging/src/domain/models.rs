//! Durable identity and message provenance shared by ingestion and sending.

use serde::{Deserialize, Serialize};

/// The official API used for an account. Personal accounts are not supported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaProvider))]
pub enum Provider {
    /// WhatsApp Cloud API with Business app coexistence.
    Whatsapp,
    /// Instagram API with Instagram Login.
    Instagram,
}

impl Provider {
    /// Stable storage spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Whatsapp => "whatsapp",
            Self::Instagram => "instagram",
        }
    }
}

/// Provenance is decided by the verified ingestion path, never by message text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaProvenance))]
pub enum Provenance {
    /// A customer message received after account connection.
    Customer,
    /// A deliberate send through Macro's external reply endpoint.
    MacroReply,
    /// A message sent in the connected account's own app.
    PhoneEcho,
    /// Provider-supplied history, accepted only after explicit account import.
    OnboardingHistory,
}

impl Provenance {
    /// Only a verified, newly received customer message can open a reply window.
    pub const fn is_new_customer_message(self) -> bool {
        matches!(self, Self::Customer)
    }
}

/// Provider identifier, scoped separately by the persisted connection.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "schema", schema(as = MetaProviderId))]
pub struct ProviderId(String);

impl ProviderId {
    /// Opaque validated identifier, never a display name or handle.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ProviderId {
    type Error = MessagingError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 512
            || value.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(MessagingError::Invalid("invalid provider identifier"));
        }
        Ok(Self(value))
    }
}

impl From<ProviderId> for String {
    fn from(id: ProviderId) -> Self {
        id.0
    }
}

/// Observed outbound state. Unknown outcomes require reconciliation, not resend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaDeliveryState))]
pub enum DeliveryState {
    /// Durable intent, not yet attempted.
    Pending,
    /// Attempt recorded before the network request.
    Sending,
    /// Request may have reached the provider; automatic replay is unsafe.
    Unknown,
    /// Provider returned an identifier; this does not establish delivery.
    Accepted,
    /// Provider reports the message sent.
    Sent,
    /// Provider reports delivery.
    Delivered,
    /// Provider reports read.
    Read,
    /// Definitive rejection or provider failure.
    Failed,
}

impl DeliveryState {
    /// Reconcile reordered status notifications without regressing positive
    /// evidence. A late failure cannot erase known delivery or a read receipt.
    pub fn reconcile(self, incoming: Self) -> Self {
        use DeliveryState::*;
        match (self, incoming) {
            (Read, _) | (_, Read) => Read,
            (Delivered, _) | (_, Delivered) => Delivered,
            (_, Failed) | (Failed, _) => Failed,
            (Sent, _) | (_, Sent) => Sent,
            (Accepted, _) | (_, Accepted) => Accepted,
            (Unknown, _) | (_, Unknown) => Unknown,
            (Sending, _) | (_, Sending) => Sending,
            _ => Pending,
        }
    }
}

/// Sanitized failures safe to expose in the native UI. Infrastructure causes are
/// retained separately in logs without tokens, provider bodies or message text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MessagingError {
    /// Invalid input with actionable non-sensitive detail.
    #[error("{0}")]
    Invalid(&'static str),
    /// Entity is absent or outside the caller's authorized scope.
    #[error("conversation or connection not found")]
    NotFound,
    /// Caller lacks current management, channel or explicit send authorization.
    #[error("you do not have permission for this messaging operation")]
    Forbidden,
    /// An existing account/source/idempotency mapping has different semantics.
    #[error("this identity is already bound; reconnect the original connection")]
    Conflict,
    /// The original intent expired before any uncertain or accepted attempt.
    #[error("send_expired")]
    SendExpired,
    /// Account is disconnected, revoked or requires renewed authorization.
    #[error("reconnect this account before sending")]
    Disconnected,
    /// WhatsApp's standard window has closed.
    #[error("choose an approved WhatsApp template to reply outside the customer service window")]
    TemplateRequired,
    /// The provider's reply window no longer permits this send.
    #[error("the reply window is closed")]
    ReplyWindowClosed,
    /// HUMAN_AGENT cannot be used for automated messages or without approval.
    #[error("human support requires an approved account and a human-authored support reply")]
    HumanSupportRequired,
    /// Meta has not granted the app access to this account/API.
    #[error(
        "Meta has not granted this app messaging access; review account permissions and app status in Meta"
    )]
    ProviderAccessRequired,
    /// Provider explicitly rejected the operation.
    #[error("the provider rejected this operation; review account health and message requirements")]
    ProviderRejected,
    /// Retryable work remains durably recorded.
    #[error("messaging is temporarily unavailable; retry shortly")]
    Unavailable,
}
