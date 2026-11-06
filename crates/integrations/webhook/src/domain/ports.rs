//! Webhook domain ports.

use super::models::{
    CreateWebhookOutcome, CreateWebhookRequest, ListWebhooksResponse, NormalizedWebhookEvent,
    PatchWebhookRequest, PreparedWebhookDelivery, RawWebhookEventQueueMessage,
    ValidateWebhookResponse, Webhook, WebhookDeliveryAttempt, WebhookEventQueueMessage,
    WebhookHttpOutcome, WebhookHttpOutcomeDetails, WebhookId, WebhookValidationResult,
    WebhookWorkerDisposition,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, time::Duration};

/// Webhook repository.
pub trait WebhookRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Into<anyhow::Error> + Send;

    /// Create a webhook and its initial rule.
    ///
    /// Namespaces are unique among a workspace's live webhooks; implementations
    /// must report a clash as [`CreateWebhookOutcome::NamespaceConflict`]
    /// rather than an error.
    fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        workspace_id: String,
        request: CreateWebhookRequest,
        signing_secret: String,
        headers: serde_json::Value,
    ) -> impl Future<Output = Result<CreateWebhookOutcome, Self::Err>> + Send;

    /// Get an active webhook by id.
    fn get_webhook(
        &self,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// List all non-deleted webhooks owned by any of the given workspaces, newest first.
    ///
    /// Unlike [`list_active_webhooks_matching_event`], this is a management view: it returns
    /// webhooks of every status and validity, not only delivery-eligible ones.
    fn list_webhooks_for_workspaces(
        &self,
        workspace_ids: Vec<String>,
    ) -> impl Future<Output = Result<Vec<Webhook>, Self::Err>> + Send;

    /// List delivery-eligible webhooks whose typed filters match an event and entity id.
    ///
    /// Delivery-eligible webhooks are active, valid, and not soft-deleted. A filter without
    /// `ids` matches every entity id.
    /// List active, valid, non-bot-owned webhooks in the given workspaces
    /// whose filters match `event` (and `entity_id`, when a filter names
    /// ids).
    fn list_active_webhooks_matching_event(
        &self,
        workspace_ids: Vec<String>,
        event: String,
        entity_id: String,
    ) -> impl Future<Output = Result<Vec<Webhook>, Self::Err>> + Send;

    /// Patch an active webhook.
    fn patch_webhook(
        &self,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// Soft-delete an active webhook.
    fn delete_webhook(
        &self,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// Set the validation state for an active webhook.
    fn set_webhook_validity(
        &self,
        webhook_id: WebhookId,
        is_valid: bool,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// Look up the team workspace id for a user.
    fn get_user_team_workspace_id(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Resolver that expands people into personal and team webhook workspace ids.
pub trait WebhookWorkspaceResolver: Clone + Send + Sync + 'static {
    /// Resolver error.
    type Err: Into<anyhow::Error> + Send;

    /// Resolve a deterministic, deduplicated set of personal and team workspace ids.
    fn resolve_workspace_ids(
        &self,
        people: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;

    /// The caller's team workspace, matching persisted-webhook create/list:
    /// highest `team_role`, one team.
    fn get_user_team_workspace_id(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Port for enqueueing one normalized event for one matched webhook.
pub trait WebhookEventEnqueuer: Clone + Send + Sync + 'static {
    /// Enqueuer error.
    type Err: Into<anyhow::Error> + Send;

    /// Enqueue one webhook event delivery.
    fn enqueue(
        &self,
        message: WebhookEventQueueMessage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Queue operations used by the inbound webhook event worker.
pub trait WebhookEventQueue: Clone + Send + Sync + 'static {
    /// Queue error.
    type Err: Into<anyhow::Error> + Send;

    /// Receive a batch of unparsed queue messages.
    fn receive_messages(
        &self,
    ) -> impl Future<Output = Result<Vec<RawWebhookEventQueueMessage>, Self::Err>> + Send;

    /// Delete a queue receipt after processing or poison-message handling.
    fn delete_message(
        &self,
        receipt_handle: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delay redelivery of a queue receipt by changing its visibility period.
    fn delay_message(
        &self,
        receipt_handle: &str,
        delay: Duration,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Repository for idempotent webhook deliveries and atomic attempt transitions.
pub trait WebhookDeliveryRepository: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Into<anyhow::Error> + Send;

    /// Create a delivery if needed and load its current state and webhook configuration.
    ///
    /// Implementations must enforce idempotency for the message's webhook and event ids.
    /// `None` indicates that the webhook does not exist and no delivery could be prepared.
    fn prepare_delivery(
        &self,
        message: &WebhookEventQueueMessage,
    ) -> impl Future<Output = Result<Option<PreparedWebhookDelivery>, Self::Err>> + Send;

    /// Mark a prepared, non-terminal delivery as canceled without creating an attempt.
    fn cancel_delivery(
        &self,
        delivery_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Lock a delivery row and begin its next one-based attempt.
    ///
    /// Implementations must re-check status and `next_attempt_at` while holding the
    /// row lock. `None` means the delivery is terminal or is not ready for an attempt.
    fn begin_attempt(
        &self,
        delivery_id: &str,
    ) -> impl Future<Output = Result<Option<WebhookDeliveryAttempt>, Self::Err>> + Send;

    /// Atomically record a successful attempt and delivered webhook state.
    fn record_success(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically record a retryable failure and schedule the next attempt.
    fn record_retryable_failure(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
        next_attempt_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically record an attempt and delivery as permanently failed.
    fn record_permanent_failure(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically record a failed attempt and delivery as exhausted.
    fn record_exhaustion(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Client that sends one signed webhook request using current webhook configuration.
pub trait WebhookDeliveryClient: Clone + Send + Sync + 'static {
    /// Client error for failures that cannot be represented as an HTTP outcome.
    type Err: Into<anyhow::Error> + Send;

    /// Deliver the complete broker envelope to a webhook endpoint.
    fn deliver(
        &self,
        webhook: &Webhook,
        event: &NormalizedWebhookEvent,
    ) -> impl Future<Output = Result<WebhookHttpOutcome, Self::Err>> + Send;
}

/// Domain service that prepares, attempts, and records one queued webhook event.
pub trait WebhookEventDeliveryService: Clone + Send + Sync + 'static {
    /// Delivery service error.
    type Err: Into<anyhow::Error> + Send;

    /// Process one valid queue payload and choose how its receipt should be handled.
    fn deliver_event(
        &self,
        message: WebhookEventQueueMessage,
    ) -> impl Future<Output = Result<WebhookWorkerDisposition, Self::Err>> + Send;
}

/// Client used to send a signed webhook validation delivery.
pub trait WebhookValidationClient: Clone + Send + Sync + 'static {
    /// Client error.
    type Err: Into<anyhow::Error> + Send;

    /// Attempt a signed test delivery to the current endpoint.
    fn validate_webhook(
        &self,
        webhook: Webhook,
    ) -> impl Future<Output = Result<WebhookValidationResult, Self::Err>> + Send;
}

/// Webhook service.
pub trait WebhookService: Clone + Send + Sync + 'static {
    /// Create a webhook.
    fn create_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        request: CreateWebhookRequest,
    ) -> impl Future<Output = Result<Webhook, WebhookError>> + Send;

    /// Get a webhook the caller is authorized to see.
    fn get_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<Webhook, WebhookError>> + Send;

    /// List the webhooks the caller can see across their personal and team workspaces.
    fn list_webhooks(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ListWebhooksResponse, WebhookError>> + Send;

    /// Patch a webhook.
    fn patch_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> impl Future<Output = Result<Webhook, WebhookError>> + Send;

    /// Validate a webhook endpoint.
    fn validate_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<ValidateWebhookResponse, WebhookError>> + Send;

    /// Delete a webhook.
    fn delete_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<(), WebhookError>> + Send;
}

/// Webhook service error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookError {
    /// Bad request.
    #[error("{0}")]
    BadRequest(String),
    /// Conflict with existing state.
    #[error("{0}")]
    Conflict(String),
    /// Unauthorized.
    #[error("unauthorized")]
    Unauthorized,
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Repository or adapter error.
    #[error(transparent)]
    Repo(#[from] anyhow::Error),
}
