//! Webhook domain models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Webhook id. Webhook ids are stored with a `wh_` prefix.
pub type WebhookId = String;

/// Custom headers supplied for webhook delivery.
pub type WebhookHeaders = BTreeMap<String, String>;

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

/// Request to create a webhook.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateWebhookRequest {
    /// Workspace that owns the webhook.
    pub workspace_id: String,
    /// Display name.
    pub name: String,
    /// HTTPS endpoint URL.
    pub endpoint_url: String,
    /// Optional custom delivery headers.
    pub headers: Option<WebhookHeaders>,
    /// Rule definition used to match events.
    pub rule: Value,
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
    /// Rule definition used to match events.
    pub rule: Option<Value>,
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
    /// Event matching rule.
    pub rule: Value,
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
