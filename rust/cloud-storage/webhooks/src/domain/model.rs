//! Webhook domain models and the request/response DTOs for the configuration
//! API. These types carry no port dependencies so they compile with only the
//! base feature set.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::{
    ids::{WebhookId, WebhookRuleId},
    rule::{FilterGroup, RuleDefinition},
};

/// The lifecycle status of a webhook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum WebhookStatus {
    /// Active; matching events are delivered.
    Enabled,
    /// Disabled by the user; no deliveries.
    Disabled,
    /// Automatically paused due to repeated delivery failures.
    PausedDueToFailures,
    /// Soft-deleted.
    Deleted,
}

impl WebhookStatus {
    /// The stable string stored in the database (matches the JSON form).
    pub fn as_str(self) -> &'static str {
        match self {
            WebhookStatus::Enabled => "enabled",
            WebhookStatus::Disabled => "disabled",
            WebhookStatus::PausedDueToFailures => "paused_due_to_failures",
            WebhookStatus::Deleted => "deleted",
        }
    }

    /// Parse the database/string form back into a status.
    pub fn from_db_str(value: &str) -> Option<Self> {
        match value {
            "enabled" => Some(WebhookStatus::Enabled),
            "disabled" => Some(WebhookStatus::Disabled),
            "paused_due_to_failures" => Some(WebhookStatus::PausedDueToFailures),
            "deleted" => Some(WebhookStatus::Deleted),
            _ => None,
        }
    }
}

/// A webhook's public representation. **Never** includes the signing secret or
/// the decrypted custom headers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct Webhook {
    /// The webhook id.
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub id: WebhookId,
    /// Owning workspace (tenant boundary).
    pub workspace_id: String,
    /// The owning user, if any.
    pub owner_user_id: Option<MacroUserIdStr<'static>>,
    /// Human-readable name.
    pub name: String,
    /// The destination URL.
    pub endpoint_url: String,
    /// Current status.
    pub status: WebhookStatus,
    /// When the webhook was auto-paused, if it currently is.
    pub paused_at: Option<DateTime<Utc>>,
    /// Why the webhook was paused, if it currently is.
    pub pause_reason: Option<String>,
    /// Last successful delivery time.
    pub last_success_at: Option<DateTime<Utc>>,
    /// Last failed delivery time.
    pub last_failure_at: Option<DateTime<Utc>>,
    /// The user that created the webhook.
    pub created_by_user_id: MacroUserIdStr<'static>,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
    /// The webhook's single rule, if one exists.
    pub rule: Option<WebhookRule>,
}

/// A webhook's single rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct WebhookRule {
    /// The rule id.
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub id: WebhookRuleId,
    /// The webhook this rule belongs to.
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub webhook_id: WebhookId,
    /// Owning workspace.
    pub workspace_id: String,
    /// Optional human-readable name.
    pub name: Option<String>,
    /// Whether the rule is enabled.
    pub enabled: bool,
    /// The typed rule definition (events + filters).
    #[cfg_attr(feature = "axum", schema(value_type = Object))]
    pub definition: RuleDefinition,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
}

/// The rule portion of a create/patch request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct RuleInput {
    /// Optional rule name.
    #[serde(default)]
    pub name: Option<String>,
    /// Whether the rule is enabled (defaults to `true`).
    #[serde(default)]
    pub enabled: Option<bool>,
    /// Rule schema version (defaults to the current version).
    #[serde(default)]
    pub version: Option<u16>,
    /// Event names to subscribe to (at least one).
    pub events: Vec<String>,
    /// Optional filter tree.
    #[serde(default)]
    #[cfg_attr(feature = "axum", schema(value_type = Object))]
    pub filters: Option<FilterGroup>,
}

/// Request body for `POST /webhooks`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CreateWebhookRequest {
    /// Human-readable name.
    pub name: String,
    /// The destination URL (must be validated `https`).
    pub endpoint_url: String,
    /// Optional custom outbound headers (encrypted at rest). Reserved headers
    /// are rejected.
    #[serde(default)]
    pub headers: Option<BTreeMap<String, String>>,
    /// The webhook's rule.
    pub rule: RuleInput,
}

/// Request body for `PATCH /webhooks/{id}`. Every field is optional; only the
/// provided fields are changed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PatchWebhookRequest {
    /// New name.
    #[serde(default)]
    pub name: Option<String>,
    /// New endpoint URL (re-validated).
    #[serde(default)]
    pub endpoint_url: Option<String>,
    /// Replacement custom headers.
    #[serde(default)]
    pub headers: Option<BTreeMap<String, String>>,
    /// New status (e.g. enable/disable).
    #[serde(default)]
    pub status: Option<WebhookStatus>,
    /// Replacement rule (re-validated, including resource access).
    #[serde(default)]
    pub rule: Option<RuleInput>,
}

/// Response body for `POST /webhooks`. The `signing_secret` is returned **once**
/// at creation; it is never retrievable again.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CreateWebhookResponse {
    /// The created webhook.
    pub webhook: Webhook,
    /// The plaintext signing secret, shown only here.
    pub signing_secret: String,
}

/// The authenticated caller and the workspace the operation is scoped to.
///
/// Built by the inbound layer from the request's user context; the service
/// treats it as the authority for both ownership and resource access checks.
#[derive(Debug, Clone)]
pub struct WebhookActor {
    /// The acting user.
    pub user_id: MacroUserIdStr<'static>,
    /// The workspace (tenant) the webhook belongs to.
    pub workspace_id: String,
    /// The user's organization id. Reserved for future org-scoped access checks
    /// (e.g. role-based `get_entity_permission`); the current resource gate uses
    /// membership-based `get_access_level`, which needs no org id.
    pub org_id: Option<i64>,
}

/// Header names that callers may not override, because the delivery layer sets
/// them itself (see `webhooks_plan.md` "Header Handling").
pub const RESERVED_HEADER_NAMES: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "user-agent",
    "content-type",
    "x-macro-event",
    "x-macro-event-id",
    "x-macro-delivery-id",
    "x-macro-ordering-key",
    "x-macro-attempt",
    "x-macro-timestamp",
    "x-macro-signature",
];

/// Returns the first reserved header present in `headers`, if any (case-insensitive).
pub fn first_reserved_header(headers: &BTreeMap<String, String>) -> Option<String> {
    headers.keys().find_map(|name| {
        let lower = name.to_ascii_lowercase();
        RESERVED_HEADER_NAMES
            .contains(&lower.as_str())
            .then_some(name.clone())
    })
}

#[cfg(test)]
mod test;
