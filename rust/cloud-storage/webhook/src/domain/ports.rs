//! Webhook domain ports.

use super::models::{
    CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook, WebhookId,
    WebhookValidationResult,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;

/// Webhook repository.
pub trait WebhookRepo: Clone + Send + Sync + 'static {
    /// Repository error.
    type Err: Into<anyhow::Error> + Send;

    /// Create a webhook and its initial rule.
    fn create_webhook(
        &self,
        created_by_user_id: MacroUserIdStr<'static>,
        request: CreateWebhookRequest,
        secret_encrypted: String,
        headers_encrypted: serde_json::Value,
    ) -> impl Future<Output = Result<Webhook, Self::Err>> + Send;

    /// Get an active webhook by id.
    fn get_webhook(
        &self,
        webhook_id: WebhookId,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// Patch an active webhook.
    fn patch_webhook(
        &self,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// Set the validation state for an active webhook.
    fn set_webhook_validity(
        &self,
        webhook_id: WebhookId,
        is_valid: bool,
    ) -> impl Future<Output = Result<Option<Webhook>, Self::Err>> + Send;

    /// Check whether a user can edit a workspace.
    fn user_can_edit_workspace(
        &self,
        user_id: MacroUserIdStr<'static>,
        workspace_id: String,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
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
}

/// Webhook service error.
#[derive(Debug, thiserror::Error)]
pub enum WebhookError {
    /// Bad request.
    #[error("{0}")]
    BadRequest(String),
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
