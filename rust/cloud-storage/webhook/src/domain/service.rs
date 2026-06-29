//! Webhook service implementation.

use super::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook, WebhookId,
        WebhookValidationResult,
    },
    ports::{WebhookError, WebhookRepo, WebhookService, WebhookValidationClient},
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use url::Url;

const MAX_NAME_LEN: usize = 128;
const VALIDATION_EVENT_NAME: &str = "webhook.validation.test";

/// Webhook service implementation.
#[derive(Debug, Clone)]
pub struct WebhookServiceImpl<R, V> {
    repo: R,
    validation_client: V,
}

impl<R, V> WebhookServiceImpl<R, V> {
    /// Create a webhook service.
    pub fn new(repo: R, validation_client: V) -> Self {
        Self {
            repo,
            validation_client,
        }
    }
}

fn validate_name(name: &str) -> Result<(), WebhookError> {
    let name = name.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(WebhookError::BadRequest(format!(
            "name must be non-empty and at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(())
}

fn validate_endpoint_url(endpoint_url: &str) -> Result<(), WebhookError> {
    let url = Url::parse(endpoint_url)
        .map_err(|_| WebhookError::BadRequest("endpoint_url must be a valid URL".to_string()))?;

    if url.scheme() != "https" {
        return Err(WebhookError::BadRequest(
            "endpoint_url must use https".to_string(),
        ));
    }

    match url.host_str() {
        Some("localhost" | "127.0.0.1" | "::1") => Err(WebhookError::BadRequest(
            "endpoint_url must not point to localhost".to_string(),
        )),
        Some(_) => Ok(()),
        None => Err(WebhookError::BadRequest(
            "endpoint_url must include a host".to_string(),
        )),
    }
}

fn validate_rule(rule: &serde_json::Value) -> Result<(), WebhookError> {
    if let Some(version) = rule.get("version")
        && version != "v1"
        && version != "V1"
        && version != 1
    {
        return Err(WebhookError::BadRequest(
            "rule.version must be v1".to_string(),
        ));
    }

    let events = rule
        .get("events")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| WebhookError::BadRequest("rule.events must be an array".to_string()))?;

    if events.is_empty() || !events.iter().all(|event| event.as_str().is_some()) {
        return Err(WebhookError::BadRequest(
            "rule.events must be a non-empty array of strings".to_string(),
        ));
    }

    Ok(())
}

fn validate_create_request(request: &CreateWebhookRequest) -> Result<(), WebhookError> {
    validate_name(&request.name)?;
    validate_endpoint_url(&request.endpoint_url)?;
    validate_rule(&request.rule)
}

fn validate_patch_request(request: &PatchWebhookRequest) -> Result<(), WebhookError> {
    if let Some(name) = &request.name {
        validate_name(name)?;
    }
    if let Some(endpoint_url) = &request.endpoint_url {
        validate_endpoint_url(endpoint_url)?;
    }
    if let Some(rule) = &request.rule {
        validate_rule(rule)?;
    }
    Ok(())
}

fn webhook_is_missing(webhook: &Webhook) -> bool {
    webhook.deleted_at.is_some() || webhook.rule.deleted_at.is_some()
}

// Temporary placeholder until repository-level secret encryption is wired.
fn generate_placeholder_encrypted_secret(caller: &MacroUserIdStr<'_>) -> String {
    format!(
        "temporary-unencrypted-secret:{}:{}",
        caller.as_ref(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
}

fn validation_response(
    webhook_id: WebhookId,
    result: WebhookValidationResult,
) -> ValidateWebhookResponse {
    ValidateWebhookResponse {
        webhook_id,
        is_valid: result.is_valid,
        response_status: result.response_status,
        message: result.message,
    }
}

impl<R, V> WebhookServiceImpl<R, V>
where
    R: WebhookRepo,
    V: WebhookValidationClient,
{
    async fn load_authorized_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> Result<Webhook, WebhookError> {
        let webhook = self
            .repo
            .get_webhook(webhook_id)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
            .filter(|webhook| !webhook_is_missing(webhook))
            .ok_or_else(|| WebhookError::NotFound("webhook not found".to_string()))?;

        if !self
            .repo
            .user_can_edit_workspace(caller, webhook.workspace_id.clone())
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
        {
            return Err(WebhookError::Unauthorized);
        }

        Ok(webhook)
    }
}

impl<R, V> WebhookService for WebhookServiceImpl<R, V>
where
    R: WebhookRepo,
    V: WebhookValidationClient,
{
    async fn create_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        request: CreateWebhookRequest,
    ) -> Result<Webhook, WebhookError> {
        validate_create_request(&request)?;

        if !self
            .repo
            .user_can_edit_workspace(caller.clone(), request.workspace_id.clone())
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
        {
            return Err(WebhookError::Unauthorized);
        }

        let secret_encrypted = generate_placeholder_encrypted_secret(&caller);
        let headers_encrypted = serde_json::to_value(request.headers.clone().unwrap_or_default())
            .map_err(|err| WebhookError::Repo(err.into()))?;
        let mut webhook = self
            .repo
            .create_webhook(caller, request, secret_encrypted, headers_encrypted)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?;
        webhook.is_valid = false;
        Ok(webhook)
    }

    async fn patch_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> Result<Webhook, WebhookError> {
        let webhook = self
            .load_authorized_webhook(caller, webhook_id.clone())
            .await?;
        validate_patch_request(&request)?;
        let reset_validity = request.endpoint_url.is_some() || request.headers.is_some();

        let patched = self
            .repo
            .patch_webhook(webhook.id, request)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
            .ok_or_else(|| WebhookError::NotFound("webhook not found".to_string()))?;

        if !reset_validity {
            return Ok(patched);
        }

        self.repo
            .set_webhook_validity(patched.id, false)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
            .ok_or_else(|| WebhookError::NotFound("webhook not found".to_string()))
    }

    async fn validate_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> Result<ValidateWebhookResponse, WebhookError> {
        let webhook = self
            .load_authorized_webhook(caller, webhook_id.clone())
            .await?;
        let result = self
            .validation_client
            .validate_webhook(webhook)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?;
        let is_valid = result.is_valid;

        self.repo
            .set_webhook_validity(webhook_id.clone(), is_valid)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
            .ok_or_else(|| WebhookError::NotFound("webhook not found".to_string()))?;

        Ok(validation_response(webhook_id, result))
    }
}

/// Test event name used by validation adapters.
pub const fn validation_event_name() -> &'static str {
    VALIDATION_EVENT_NAME
}
