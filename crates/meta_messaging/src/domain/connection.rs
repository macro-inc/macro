//! Account lifecycle and deliberate external send commands.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    events::MediaKind,
    models::{DeliveryState, Provider, ProviderId},
};

/// Public account health; never includes credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaConnection))]
pub struct Connection {
    /// Macro connection identity, preserved through reconnect.
    pub id: Uuid,
    /// Owning Macro team.
    pub team_id: Uuid,
    /// Current connector. Reconnect changes this user without transferring existing channel/file grants.
    pub user_id: String,
    /// Official API used by this connection.
    pub provider: Provider,
    /// Connected phone-number ID or Instagram professional ID.
    pub account_id: ProviderId,
    /// WhatsApp messaging-account ID, absent for Instagram Login.
    pub business_account_id: Option<ProviderId>,
    /// Display label returned by the provider.
    pub display_name: String,
    /// Current local connection health.
    pub status: ConnectionStatus,
    /// Last successful connection time, not the start of imported history.
    pub connected_at: Option<DateTime<Utc>>,
    /// Expiry returned by the provider; absence does not mean irrevocable access.
    pub credential_expires_at: Option<DateTime<Utc>>,
    /// Verified HUMAN_AGENT approval; false by default.
    pub human_agent_approved: bool,
    /// Server-verified WhatsApp onboarding mode; absent for Instagram.
    pub whatsapp_mode: Option<WhatsappMode>,
    /// Registration state for Platform numbers only.
    pub registration_status: Option<RegistrationStatus>,
    /// Time of the latest uncertain or rate-limited registration attempt; never a PIN.
    pub registration_attempted_at: Option<DateTime<Utc>>,
    /// Development test number; never evidence of coexistence.
    pub developer_account: bool,
    /// Sanitized operational error code.
    pub health_error: Option<String>,
}

/// Disconnect outcome; removing one phone must preserve a shared WABA subscription.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct DisconnectResult {
    /// Meta confirmed removal of this app's subscription.
    pub remote_unsubscribed: bool,
    /// Another connected account still needs the same provider subscription.
    pub shared_subscription_kept: bool,
}

/// Connection state transitions do not delete retained channels/content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaConnectionStatus))]
pub enum ConnectionStatus {
    /// Token stored; subscription/sync work is pending.
    Connecting,
    /// Verified and subscribed.
    Connected,
    /// Intentionally disconnected, credential erased.
    Disconnected,
    /// Provider revoked access.
    Revoked,
    /// Needs recovery; exact sanitized reason is on the connection.
    Error,
}

/// History progress is independent from live account health.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaHistoryStatus))]
pub enum HistoryStatus {
    /// No history request was sent.
    NotRequested,
    /// Request safely scheduled.
    Pending,
    /// Provider accepted synchronization; receipt is not completion.
    Syncing,
    /// Provider reported completion.
    Complete,
    /// Customer declined sharing.
    Declined,
    /// Synchronization could not be completed.
    Failed,
}

/// Secret material zeroizes on drop and deliberately lacks Debug and Serialize.
pub struct AccessToken(zeroize::Zeroizing<String>);
impl AccessToken {
    /// Validate the bounded token without ever echoing it in errors.
    pub fn new(value: String) -> Result<Self, super::models::MessagingError> {
        let value = zeroize::Zeroizing::new(value);
        if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
            return Err(super::models::MessagingError::Invalid(
                "invalid provider credential",
            ));
        }
        Ok(Self(value))
    }
    /// Expose only at the cipher/provider boundary.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

/// Account facts resolved by the official provider using an exchanged code.
pub struct AuthorizedAccount {
    /// Server-verified mode, independent of browser assertions.
    pub whatsapp_mode: Option<WhatsappMode>,
    /// Verified registration state; coexistence and Instagram do not register here.
    pub registration_status: Option<RegistrationStatus>,
    /// Account was verified through the explicitly enabled local developer path.
    pub developer_account: bool,
    /// Identity independently verified by the provider, not trusted from the browser.
    pub account_id: ProviderId,
    /// WhatsApp messaging-account ID, when applicable.
    pub business_account_id: Option<ProviderId>,
    /// Provider display label.
    pub display_name: String,
    /// Business token or long-lived Instagram token.
    pub token: AccessToken,
    /// Provider-declared expiry.
    pub expires_at: Option<DateTime<Utc>>,
}

/// Display information obtained through the receiving business account's token.
#[derive(Clone, Default)]
pub struct CustomerProfile {
    /// Provider display name, when available.
    pub name: Option<String>,
    /// Mutable handle, never used as an identity or permission principal.
    pub handle: Option<String>,
}

/// Server-bound OAuth transaction.
pub struct OAuthAttempt {
    /// SHA-256 of state plus Instagram browser proof; neither is stored raw.
    pub state_sha256: Vec<u8>,
    /// Owner scope.
    pub team_id: Uuid,
    /// Authenticated initiating human.
    pub user_id: String,
    /// Product being connected.
    pub provider: Provider,
    /// Explicit existing connection on reconnect.
    pub reconnect_id: Option<Uuid>,
    /// Short expiration.
    pub expires_at: DateTime<Utc>,
}

/// Public setup configuration, returned by the server rather than hardcoded in UI.
#[derive(Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaPublicConfiguration))]
pub struct PublicConfiguration {
    /// Operator-confirmed Meta HUMAN_AGENT approval for the configured Instagram app.
    pub instagram_human_agent_approved: bool,
    /// A server-configured, recipient-restricted local WhatsApp test account exists.
    pub whatsapp_developer_available: bool,
    /// Meta app ID used by WhatsApp Embedded Signup.
    pub whatsapp_app_id: Option<String>,
    /// Facebook Login for Business v4 configuration ID with coexistence enabled.
    pub whatsapp_configuration_id: Option<String>,
    /// Optional dedicated v4 configuration for Platform signup.
    pub whatsapp_platform_configuration_id: Option<String>,
    /// Instagram app ID within the configured Meta business app.
    pub instagram_app_id: Option<String>,
    /// Approved redirect URI for Instagram Login.
    pub instagram_redirect_uri: Option<String>,
    /// Explicitly supported Graph API version.
    pub graph_version: String,
}

/// Browser OAuth initiation result. State is scoped to the authenticated initiator.
#[derive(Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaBeginAuthorization))]
pub struct BeginAuthorization {
    /// Random anti-CSRF state echoed through the callback.
    pub state: String,
    /// Secret proof retained only by the initiating Instagram window; never sent to Meta.
    pub browser_transaction: Option<String>,
    /// Public SDK/login configuration.
    pub configuration: PublicConfiguration,
}

/// Callback input. Tokens are always exchanged server-side.
#[derive(Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaCompleteAuthorization))]
pub struct CompleteAuthorization {
    /// State returned by the server for this caller/team/provider.
    pub state: String,
    /// Proof returned at initiation; mandatory for Instagram, absent for WhatsApp.
    pub browser_transaction: Option<String>,
    /// Single-use authorization code.
    pub code: String,
    /// WhatsApp account selected in Embedded Signup; verified through Graph.
    pub business_account_id: Option<ProviderId>,
    /// Phone-number selection; verified as belonging to the selected account.
    pub phone_number_id: Option<ProviderId>,
    /// Explicit signup path; the provider independently verifies its eligibility.
    pub whatsapp_mode: Option<WhatsappMode>,
}

/// Native conversation metadata, available only after ordinary channel access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaConversation))]
pub struct Conversation {
    /// Real Macro channel identity.
    pub channel_id: Uuid,
    /// Owning account's connection.
    pub connection_id: Uuid,
    /// Destination kind; group identifiers never enter person alias resolution.
    #[serde(default)]
    pub kind: super::groups::ConversationKind,
    /// Authoritative group availability, absent for direct conversations.
    #[serde(default)]
    pub group_status: Option<super::groups::GroupStatus>,
    /// Recipient's account-scoped identity.
    pub customer_id: ProviderId,
    /// Account-scoped display label; never a Macro or CRM identity.
    pub customer_display_name: Option<String>,
    /// Verified phone, when present.
    pub customer_phone: Option<String>,
    /// Mutable handle for display only.
    pub customer_handle: Option<String>,
    /// Latest eligible inbound source timestamp.
    pub last_customer_message_at: Option<DateTime<Utc>>,
}

/// An approved WhatsApp template returned from this connection's account.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaTemplate))]
pub struct Template {
    /// Provider category; authentication templates cannot be sent to groups.
    #[serde(default)]
    pub category: Option<String>,
    /// Provider template identity.
    pub id: ProviderId,
    /// Exact approved name.
    pub name: String,
    /// Exact approved language code.
    pub language: String,
    /// Approved components used for preview/parameter collection.
    pub components: serde_json::Value,
    /// Ordered text inputs, including the component and any named variable.
    pub parameter_labels: Vec<String>,
    /// Nonempty when this approved template needs inputs this composer cannot supply.
    pub unsupported_reason: Option<String>,
}

/// Explicit send action; ordinary channel posts never call this boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaSendReply))]
pub struct SendReply {
    /// Stable client intent key. A changed payload with this key is a conflict.
    pub idempotency_key: Uuid,
    /// Message payload, subject to provider-specific validation.
    pub message: ReplyContent,
    /// Optional provider message target within this same conversation.
    pub reply_to: Option<ProviderId>,
    /// Explicit human support action, never inferred from closing the window.
    #[serde(default)]
    pub human_support: bool,
}

/// Text, Macro-owned media or approved-template input. Remote arbitrary URLs are
/// not accepted from clients as attachments.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaReplyContent))]
pub enum ReplyContent {
    /// Free-form text.
    Text {
        /// UTF-8 text, checked against the selected provider's limit.
        text: String,
    },
    /// Media loaded through an authorized Macro document.
    Media {
        /// Existing Macro document ID, authorized again by the worker.
        document_id: Uuid,
        /// Desired provider media category.
        kind: MediaKind,
        /// Optional caption, where the provider permits it.
        caption: Option<String>,
    },
    /// Approved WhatsApp template, resolved by ID against the sending account.
    Template {
        /// Account-scoped provider template identity.
        template_id: ProviderId,
        /// Exact approved language.
        language: String,
        /// Ordered text parameters for header/body. Buttons and media templates
        /// are validated separately and never passed through as raw provider JSON.
        parameters: Vec<String>,
    },
}

/// Durable result of an intentional send; accepted does not mean delivered.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaSendProgress))]
pub struct SendProgress {
    /// Human who explicitly submitted this reply.
    pub user_id: String,
    /// Retained intent for recovering a failed draft without inventing content.
    pub payload: SendReply,
    /// Stable local intent ID.
    pub id: Uuid,
    /// Native conversation.
    pub channel_id: Uuid,
    /// Current delivery observation.
    pub state: DeliveryState,
    /// Linked native message, when created.
    pub message_id: Option<Uuid>,
    /// Sanitized rejection/recovery code.
    pub error_code: Option<String>,
    /// Intent creation time.
    pub created_at: DateTime<Utc>,
}

/// Metadata rendered with an authorized native channel, without management secrets.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaConversationView))]
pub struct ConversationView {
    /// Implemented send operations and content limits.
    pub capabilities: super::replies::ReplyCapabilities,
    /// Current account, user and provider eligibility, evaluated by the server.
    pub eligibility: super::replies::ReplyEligibility,
    /// Current caller may deliberately reply through this account and channel.
    pub can_reply: bool,
    /// Maximum text units, counted by the provider's rule below.
    pub text_limit: u16,
    /// Instagram counts UTF-8 bytes; WhatsApp counts characters.
    pub text_limit_in_bytes: bool,
    /// Supported attachment types and effective size limits.
    pub media: Vec<super::media::MediaCapability>,
    /// Persisted account-scoped customer identity.
    pub conversation: Conversation,
    /// Connected provider.
    pub provider: Provider,
    /// Business account shown beside the explicit send control.
    pub account_name: String,
    /// Connected/disconnected/recovery state.
    pub status: ConnectionStatus,
    /// Sanitized account-health reason, so channel users see the correct recovery action.
    pub health_error: Option<String>,
    /// Whether this connection uses an explicitly configured developer number.
    pub developer_account: bool,
    /// Server-observed eligibility for Instagram's human-support mode.
    pub human_agent_approved: bool,
    /// Durable outbound intents including pending, unknown and failed replies.
    pub sends: Vec<SendProgress>,
}

/// Optional messaging metadata for an ordinary native channel.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaConversationResponse))]
pub struct ConversationResponse {
    /// Present for pending or bound WhatsApp groups, without an invite link.
    pub group: Option<super::groups::GroupView>,
    /// Absent for ordinary internal Macro channels.
    pub messaging: Option<ConversationView>,
}

/// A private file staged for an explicit customer reply; staging never sends it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature="schema",schema(as=MetaUploadedAttachment))]
pub struct UploadedAttachment {
    /// Native Macro document, authorized again at send time.
    pub document_id: Uuid,
    /// Original display filename.
    pub filename: String,
    /// Verified attachment category.
    pub kind: MediaKind,
}

/// Supported production WhatsApp onboarding paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WhatsappMode {
    /// Keep the WhatsApp Business app and its supported history.
    Coexistence,
    /// Cloud API number without the Business app.
    Platform,
}

/// Durable registration uncertainty is separate from account health.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum RegistrationStatus {
    /// Await explicit PIN entry.
    Required,
    /// An attempt may have succeeded; reconcile without repeating it.
    Unconfirmed,
    /// Meta confirmed CONNECTED.
    Registered,
    /// Meta imposed its 72-hour registration limit.
    RateLimited,
    /// Provider state does not establish whether registration is appropriate.
    Unavailable,
}

/// Authoritative phone facts; an operational restriction is not missing registration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhoneRegistration {
    /// Cloud API registration is active.
    Registered,
    /// The number is pending registration and may accept an explicit PIN request.
    Unregistered,
    /// Restricted, transitional or unknown provider state; check again without POST.
    Unavailable,
}

impl Connection {
    /// Registration prerequisite shared by inbound and outbound policy.
    pub fn registration_ready(&self) -> bool {
        self.whatsapp_mode != Some(WhatsappMode::Platform)
            || self.registration_status == Some(RegistrationStatus::Registered)
    }
    /// One readiness rule for views, replies and lifecycle maintenance.
    pub fn is_ready(&self) -> bool {
        self.status == ConnectionStatus::Connected && self.registration_ready()
    }
}

/// A six-digit secret, accepted only in an explicit registration request.
/// Zeroized on drop, deliberately neither Debug nor Serialize, and never persisted.
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(value_type = String, pattern = "^[0-9]{6}$"))]
pub struct RegistrationPin(zeroize::Zeroizing<String>);
impl<'de> Deserialize<'de> for RegistrationPin {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        let serde_json::Value::String(pin) = value else {
            return Err(serde::de::Error::custom(
                "enter the six-digit WhatsApp PIN as text",
            ));
        };
        Self::try_from(pin).map_err(serde::de::Error::custom)
    }
}
impl TryFrom<String> for RegistrationPin {
    type Error = super::models::MessagingError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let value = zeroize::Zeroizing::new(value);
        if value.len() != 6 || !value.bytes().all(|b| b.is_ascii_digit()) {
            return Err(super::models::MessagingError::Invalid(
                "enter the six-digit WhatsApp two-step verification PIN",
            ));
        }
        Ok(Self(value))
    }
}
impl RegistrationPin {
    /// Expose only to the official provider request.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

/// A request without a PIN only checks whether a previous attempt completed.
#[derive(Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct RegisterPhone {
    /// Kept only for this request; absence never starts a new registration attempt.
    pub pin: Option<RegistrationPin>,
}

/// Registration outcomes distinguish known rejections from an uncertain POST.
pub enum RegistrationResult {
    /// Meta returned success; verify CONNECTED before activation.
    Accepted,
    /// Definitive failure, with a sanitized user-facing reason.
    Rejected(RegistrationFailure),
    /// A timeout or malformed response may conceal success.
    Unknown,
}
/// Actionable provider registration failures.
pub enum RegistrationFailure {
    /// Meta code 133005.
    IncorrectPin,
    /// Meta code 133006.
    PinAttemptsExceeded,
    /// Meta code 133016.
    RateLimited,
    /// Another definitive rejection.
    Rejected,
}
impl RegistrationFailure {
    /// Stable sanitized health code; never provider error details.
    pub fn code(&self) -> &'static str {
        match self {
            Self::IncorrectPin => "registration_pin_incorrect",
            Self::PinAttemptsExceeded => "registration_pin_attempts_exceeded",
            Self::RateLimited => "registration_rate_limited",
            Self::Rejected => "registration_rejected",
        }
    }
}
