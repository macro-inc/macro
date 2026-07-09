//! Webhook domain models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Webhook id. Webhook ids are stored with a `wh_` prefix.
pub type WebhookId = String;

/// Custom headers supplied for webhook delivery.
pub type WebhookHeaders = BTreeMap<String, String>;

/// Event and optional entity-id constraints used to match webhook deliveries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct WebhookFilter {
    /// Event names matched by this filter.
    pub events: Vec<String>,
    /// Entity ids matched by this filter. When absent, the filter matches all entity ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
}

/// Collection of webhook filters used to decide delivery eligibility.
pub type WebhookFilters = Vec<WebhookFilter>;

/// Webhook lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WebhookStatus {
    /// Webhook is active and eligible for delivery once validated.
    Active,
    /// Webhook is paused and should not receive deliveries.
    Paused,
    /// Webhook was disabled by the system.
    Disabled,
}

impl WebhookStatus {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Disabled => "disabled",
        }
    }
}

impl std::str::FromStr for WebhookStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "disabled" => Ok(Self::Disabled),
            other => Err(format!("unknown webhook status: {other}")),
        }
    }
}

/// Scope that owns a newly-created webhook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WebhookScope {
    /// The authenticated user's personal workspace.
    User,
    /// The authenticated user's team workspace.
    Team,
}

/// Request to create a webhook.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateWebhookRequest {
    /// Scope that owns the webhook.
    pub scope: WebhookScope,
    /// Display name.
    pub name: String,
    /// HTTPS endpoint URL.
    pub endpoint_url: String,
    /// Optional custom delivery headers.
    pub headers: Option<WebhookHeaders>,
    /// Typed filters used to match events and optional entity ids.
    pub filters: WebhookFilters,
}

/// Request to patch a webhook.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchWebhookRequest {
    /// Display name.
    pub name: Option<String>,
    /// HTTPS endpoint URL.
    pub endpoint_url: Option<String>,
    /// Optional custom delivery headers. When present, replaces existing headers.
    pub headers: Option<WebhookHeaders>,
    /// Typed filters used to match events and optional entity ids.
    pub filters: Option<WebhookFilters>,
    /// Webhook lifecycle status.
    pub status: Option<WebhookStatus>,
}

/// Webhook row returned by application APIs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Webhook {
    /// Webhook id.
    pub id: WebhookId,
    /// Owning workspace id.
    pub workspace_id: String,
    /// Display name.
    pub name: String,
    /// HTTPS endpoint URL.
    pub endpoint_url: String,
    /// Signing secret used by outbound adapters. This is never serialized by APIs.
    #[serde(default, skip_serializing)]
    pub signing_secret: String,
    /// Custom delivery headers, after decryption by the repository.
    pub headers: WebhookHeaders,
    /// Webhook lifecycle status.
    pub status: WebhookStatus,
    /// Whether the current endpoint configuration has passed validation.
    pub is_valid: bool,
    /// User that created the webhook.
    pub created_by_user_id: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Soft-delete timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Typed filters used to match events and optional entity ids.
    pub filters: WebhookFilters,
}

/// Sanitized result of validating a webhook endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ValidateWebhookResponse {
    /// Webhook id that was validated.
    pub webhook_id: WebhookId,
    /// Whether the endpoint accepted the signed validation delivery.
    pub is_valid: bool,
    /// HTTP response status returned by the webhook endpoint, when available.
    pub response_status: Option<u16>,
    /// Sanitized message explaining validation failure.
    pub message: Option<String>,
}

/// Sanitized result returned by the validation client port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookValidationResult {
    /// Whether the endpoint accepted the signed validation delivery.
    pub is_valid: bool,
    /// HTTP response status returned by the webhook endpoint, when available.
    pub response_status: Option<u16>,
    /// Sanitized success or failure message.
    pub message: Option<String>,
}
