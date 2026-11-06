//! Webhook domain models.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, time::Duration};

/// Webhook id. Webhook ids are stored with a `wh_` prefix.
pub type WebhookId = String;

/// Custom headers supplied for webhook delivery.
pub type WebhookHeaders = BTreeMap<String, String>;

/// Version of the webhook event queue message contract emitted by this crate.
#[cfg(feature = "ports")]
pub const WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION: u8 = 1;

/// Event data normalized from a broker envelope for webhook matching and delivery.
///
/// `broker_envelope` retains the complete payload received from the broker and is
/// the only value sent as the webhook HTTP request body.
#[cfg(feature = "ports")]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedWebhookEvent {
    /// Broker event identifier, represented as a string for transport neutrality.
    pub event_id: String,
    /// Version of the broker event payload schema.
    pub schema_version: u8,
    /// Exact event name used for webhook filter matching.
    pub event_name: String,
    /// Normalized entity type used for access resolution and delivery records.
    pub entity_type: String,
    /// Entity identifier used for access resolution and webhook filter matching.
    pub entity_id: String,
    /// Key that preserves the event ordering observed during ingestion.
    pub ordering_key: String,
    /// Time at which the broker event was ingested for webhook processing.
    pub occurred_at: DateTime<Utc>,
    /// Complete broker envelope forwarded as the webhook HTTP request body.
    pub broker_envelope: serde_json::Value,
}

/// Versioned queue payload for delivering one event to one webhook.
///
/// Endpoint URLs, custom headers, and signing secrets are deliberately absent;
/// workers must resolve the webhook's current configuration before delivery.
#[cfg(feature = "ports")]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebhookEventQueueMessage {
    /// Queue contract version.
    pub version: u8,
    /// Webhook that should receive the event.
    pub webhook_id: WebhookId,
    /// Normalized broker event to deliver.
    pub event: NormalizedWebhookEvent,
}

#[cfg(feature = "ports")]
impl WebhookEventQueueMessage {
    /// Create a queue message using the current contract version.
    pub fn new(webhook_id: WebhookId, event: NormalizedWebhookEvent) -> Self {
        Self {
            version: WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION,
            webhook_id,
            event,
        }
    }

    /// Return whether this message uses a contract version supported by this crate.
    pub fn has_supported_version(&self) -> bool {
        self.version == WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION
    }
}

/// Raw queue message retained at the queue adapter boundary.
///
/// The optional body and receipt handle are kept separate so a worker can
/// acknowledge malformed or missing payloads whenever the queue supplied a
/// receipt handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawWebhookEventQueueMessage {
    /// Queue-assigned message identifier, when supplied by the queue.
    pub message_id: Option<String>,
    /// Unparsed queue message body.
    pub body: Option<String>,
    /// Handle used to acknowledge or delay this receipt.
    pub receipt_handle: Option<String>,
}

/// Identifier of a persisted webhook delivery.
pub type WebhookDeliveryId = String;

/// Identifier of a persisted webhook delivery attempt.
pub type WebhookDeliveryAttemptId = String;

/// Persisted lifecycle state of a webhook delivery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookDeliveryStatus {
    /// Delivery is persisted and ready for its first attempt.
    Queued,
    /// An HTTP attempt has started and has not completed.
    InProgress,
    /// A retryable attempt failed and another attempt is scheduled.
    RetryScheduled,
    /// The endpoint accepted the event.
    Delivered,
    /// Delivery ended after a non-retryable failure.
    PermanentlyFailed,
    /// Delivery exhausted the configured HTTP attempt limit.
    Exhausted,
    /// Delivery was canceled because the webhook is no longer eligible.
    Canceled,
}

impl WebhookDeliveryStatus {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::InProgress => "in_progress",
            Self::RetryScheduled => "retry_scheduled",
            Self::Delivered => "delivered",
            Self::PermanentlyFailed => "permanently_failed",
            Self::Exhausted => "exhausted",
            Self::Canceled => "canceled",
        }
    }

    /// Return whether this status prevents any further HTTP attempts.
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Delivered | Self::PermanentlyFailed | Self::Exhausted | Self::Canceled
        )
    }
}

impl std::str::FromStr for WebhookDeliveryStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "queued" => Ok(Self::Queued),
            "in_progress" => Ok(Self::InProgress),
            "retry_scheduled" => Ok(Self::RetryScheduled),
            "delivered" => Ok(Self::Delivered),
            "permanently_failed" => Ok(Self::PermanentlyFailed),
            "exhausted" => Ok(Self::Exhausted),
            "canceled" => Ok(Self::Canceled),
            other => Err(format!("unknown webhook delivery status: {other}")),
        }
    }
}

/// Persisted lifecycle state of one webhook delivery attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookDeliveryAttemptStatus {
    /// The HTTP request has started and has not completed.
    InProgress,
    /// The endpoint accepted the request.
    Succeeded,
    /// The request failed with a retryable outcome.
    RetryableFailure,
    /// The request failed with a permanent outcome.
    PermanentFailure,
    /// The request failed and exhausted the delivery's attempt limit.
    Exhausted,
    /// Processing stopped before the attempt outcome could be recorded.
    Interrupted,
}

impl WebhookDeliveryAttemptStatus {
    /// Storage representation.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::Succeeded => "succeeded",
            Self::RetryableFailure => "retryable_failure",
            Self::PermanentFailure => "permanent_failure",
            Self::Exhausted => "exhausted",
            Self::Interrupted => "interrupted",
        }
    }
}

impl std::str::FromStr for WebhookDeliveryAttemptStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "in_progress" => Ok(Self::InProgress),
            "succeeded" => Ok(Self::Succeeded),
            "retryable_failure" => Ok(Self::RetryableFailure),
            "permanent_failure" => Ok(Self::PermanentFailure),
            "exhausted" => Ok(Self::Exhausted),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(format!("unknown webhook delivery attempt status: {other}")),
        }
    }
}

/// Transport-neutral metadata captured from one webhook HTTP request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookHttpOutcomeDetails {
    /// Time spent making the HTTP request.
    pub duration: Duration,
    /// HTTP response status, when the endpoint returned a response.
    pub response_status: Option<u16>,
    /// Response header names with values redacted by the delivery client.
    pub response_headers_redacted: Option<WebhookHeaders>,
    /// Lossy response-body preview, capped by the delivery client.
    pub response_body_preview: Option<String>,
    /// Sanitized failure category, when the request failed.
    pub error_kind: Option<String>,
    /// Sanitized failure message, when the request failed.
    pub error_message: Option<String>,
}

/// Classification and metadata returned by a webhook HTTP delivery client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookHttpOutcome {
    /// The endpoint returned a successful response.
    Success(WebhookHttpOutcomeDetails),
    /// The request may succeed if attempted again.
    RetryableFailure(WebhookHttpOutcomeDetails),
    /// The request must not be attempted again.
    PermanentFailure(WebhookHttpOutcomeDetails),
}

/// Current persisted delivery and webhook configuration loaded idempotently.
#[derive(Debug, Clone)]
pub struct PreparedWebhookDelivery {
    /// Persisted delivery identifier.
    pub delivery_id: WebhookDeliveryId,
    /// Current webhook configuration, including outbound-only signing material.
    pub webhook: Webhook,
    /// Current persisted delivery status.
    pub status: WebhookDeliveryStatus,
    /// Number of HTTP attempts that have already started.
    pub attempt_count: u32,
    /// Earliest time at which another attempt may begin.
    pub next_attempt_at: Option<DateTime<Utc>>,
}

/// Numbered webhook delivery attempt started by the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookDeliveryAttempt {
    /// Persisted attempt identifier.
    pub attempt_id: WebhookDeliveryAttemptId,
    /// Delivery to which this attempt belongs.
    pub delivery_id: WebhookDeliveryId,
    /// One-based attempt number.
    pub attempt_number: u32,
}

/// Action the inbound worker should apply to a processed queue receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebhookWorkerDisposition {
    /// Delete the queue receipt.
    Acknowledge,
    /// Make the queue receipt available again after the supplied delay.
    RetryAfter(Duration),
}

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

impl WebhookFilter {
    /// Return whether this filter accepts an event name and entity id.
    pub fn accepts(&self, event_name: &str, entity_id: &str) -> bool {
        self.events.iter().any(|event| event == event_name)
            && self
                .ids
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|id| id == entity_id))
    }
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
///
/// Clients serialize this, so both derives are used. `Display`/`FromStr`
/// spell the same names as serde, for query strings and config values.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum WebhookScope {
    /// The authenticated user's personal workspace.
    User,
    /// The authenticated user's team workspace.
    Team,
}

/// Endpoint restrictions applied to webhook URLs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum WebhookEndpointSchemePolicy {
    /// Require HTTPS endpoints with public addresses.
    #[default]
    HttpsOnly,
    /// Allow HTTP and non-public addresses for local testing.
    HttpAndHttps,
}

impl WebhookEndpointSchemePolicy {
    /// Return whether the URL scheme is permitted by this policy.
    pub fn allows(self, scheme: &str) -> bool {
        scheme == "https" || (self == Self::HttpAndHttps && scheme == "http")
    }

    /// Return whether localhost, loopback, private, and link-local addresses are permitted.
    pub fn allows_local_addresses(self) -> bool {
        self == Self::HttpAndHttps
    }
}

/// Request to create a webhook.
///
/// Clients serialize this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateWebhookRequest {
    /// Scope that owns the webhook.
    pub scope: WebhookScope,
    /// Caller-chosen namespace, unique among the owning workspace's webhooks.
    /// Set at creation time only; it cannot be changed afterwards.
    pub namespace: String,
    /// Display name.
    pub name: String,
    /// Endpoint URL. HTTPS is required outside local environments.
    pub endpoint_url: String,
    /// Optional custom delivery headers.
    pub headers: Option<WebhookHeaders>,
    /// Typed filters used to match events and optional entity ids.
    pub filters: WebhookFilters,
}

/// Request to patch a webhook. The webhook's namespace is fixed at creation
/// time and is deliberately not patchable.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchWebhookRequest {
    /// Display name.
    pub name: Option<String>,
    /// Endpoint URL. HTTPS is required outside local environments.
    pub endpoint_url: Option<String>,
    /// Optional custom delivery headers. When present, replaces existing headers.
    pub headers: Option<WebhookHeaders>,
    /// Typed filters used to match events and optional entity ids.
    pub filters: Option<WebhookFilters>,
    /// Webhook lifecycle status.
    pub status: Option<WebhookStatus>,
}

/// Outcome of persisting a new webhook.
#[cfg(feature = "ports")]
#[derive(Debug, Clone)]
pub enum CreateWebhookOutcome {
    /// The webhook was created.
    Created(Box<Webhook>),
    /// A live webhook in the workspace already uses the requested namespace.
    NamespaceConflict,
}

/// Webhook row returned by application APIs.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct Webhook {
    /// Webhook id.
    pub id: WebhookId,
    /// Owning workspace id.
    pub workspace_id: String,
    /// Caller-chosen namespace, unique among the owning workspace's webhooks.
    /// Set at creation time only; it cannot be changed afterwards.
    pub namespace: String,
    /// Display name.
    pub name: String,
    /// Endpoint URL. HTTPS is required outside local environments.
    pub endpoint_url: String,
    /// Signing secret used by outbound adapters. Generic webhook API responses omit it;
    /// creation exposes it separately through [`CreateWebhookResponse`].
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

/// Webhook returned after creation, including its signing secret.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateWebhookResponse {
    /// Webhook id.
    pub id: WebhookId,
    /// Owning workspace id.
    pub workspace_id: String,
    /// Caller-chosen namespace, unique among the owning workspace's webhooks.
    /// Set at creation time only; it cannot be changed afterwards.
    pub namespace: String,
    /// Display name.
    pub name: String,
    /// Endpoint URL. HTTPS is required outside local environments.
    pub endpoint_url: String,
    /// Signing secret used to verify webhook delivery signatures.
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

impl From<Webhook> for CreateWebhookResponse {
    fn from(webhook: Webhook) -> Self {
        Self {
            id: webhook.id,
            workspace_id: webhook.workspace_id,
            namespace: webhook.namespace,
            name: webhook.name,
            endpoint_url: webhook.endpoint_url,
            signing_secret: webhook.signing_secret,
            headers: webhook.headers,
            status: webhook.status,
            is_valid: webhook.is_valid,
            created_by_user_id: webhook.created_by_user_id,
            created_at: webhook.created_at,
            updated_at: webhook.updated_at,
            deleted_at: webhook.deleted_at,
            filters: webhook.filters,
        }
    }
}

/// Webhooks visible to the caller across their personal and team workspaces.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ListWebhooksResponse {
    /// The caller's webhooks, newest first. Signing secrets are omitted.
    pub webhooks: Vec<Webhook>,
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

/// Body of the `webhook.validation.test` delivery sent when validating an
/// endpoint. Not part of the `WebhookEvent` entity-event union.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct WebhookValidationTestEvent {
    /// Event id, with an `evt_` prefix.
    pub id: String,
    /// Event name; always `webhook.validation.test`.
    pub event: String,
    /// Webhook being validated.
    pub webhook_id: WebhookId,
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
