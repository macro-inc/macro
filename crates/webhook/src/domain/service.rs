//! Webhook service implementation.

use super::{
    models::{
        CreateWebhookRequest, PatchWebhookRequest, ValidateWebhookResponse, Webhook,
        WebhookEndpointSchemePolicy, WebhookFilters, WebhookId, WebhookScope,
        WebhookValidationResult,
    },
    ports::{WebhookError, WebhookRepo, WebhookService, WebhookValidationClient},
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use std::net::IpAddr;
use url::Url;

const MAX_NAME_LEN: usize = 128;
const MAX_FILTERS: usize = 50;
const MAX_FILTER_EVENTS: usize = 100;
const MAX_FILTER_IDS: usize = 100;
const MAX_FILTER_VALUE_LEN: usize = 256;
const VALIDATION_EVENT_NAME: &str = "webhook.validation.test";

/// Webhook service implementation.
#[derive(Debug, Clone)]
pub struct WebhookServiceImpl<R, V> {
    repo: R,
    validation_client: V,
    endpoint_scheme_policy: WebhookEndpointSchemePolicy,
}

impl<R, V> WebhookServiceImpl<R, V> {
    /// Create a webhook service that requires public HTTPS endpoints.
    pub fn new(repo: R, validation_client: V) -> Self {
        Self::new_with_endpoint_scheme_policy(
            repo,
            validation_client,
            WebhookEndpointSchemePolicy::HttpsOnly,
        )
    }

    /// Create a webhook service with an explicit endpoint policy.
    pub fn new_with_endpoint_scheme_policy(
        repo: R,
        validation_client: V,
        endpoint_scheme_policy: WebhookEndpointSchemePolicy,
    ) -> Self {
        Self {
            repo,
            validation_client,
            endpoint_scheme_policy,
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

fn validate_endpoint_url(
    endpoint_url: &str,
    endpoint_scheme_policy: WebhookEndpointSchemePolicy,
) -> Result<(), WebhookError> {
    let url = Url::parse(endpoint_url)
        .map_err(|_| WebhookError::BadRequest("endpoint_url must be a valid URL".to_string()))?;

    if !endpoint_scheme_policy.allows(url.scheme()) {
        return Err(WebhookError::BadRequest(
            "endpoint_url must use https".to_string(),
        ));
    }

    let Some(host) = url.host_str() else {
        return Err(WebhookError::BadRequest(
            "endpoint_url must include a host".to_string(),
        ));
    };

    if !endpoint_scheme_policy.allows_local_addresses() && is_blocked_endpoint_host(host) {
        return Err(WebhookError::BadRequest(
            "endpoint_url host is not allowed".to_string(),
        ));
    }

    Ok(())
}

fn is_blocked_endpoint_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }

    host.parse::<IpAddr>().is_ok_and(is_blocked_endpoint_ip)
}

fn is_blocked_endpoint_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.octets() == [169, 254, 169, 254]
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn validate_filter_value(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value.len() <= MAX_FILTER_VALUE_LEN
}

fn validate_filter_events(events: &[String]) -> Result<(), WebhookError> {
    if events.is_empty() {
        return Err(WebhookError::BadRequest(
            "filters[].events must be a non-empty array of strings".to_string(),
        ));
    }

    if events.len() > MAX_FILTER_EVENTS {
        return Err(WebhookError::BadRequest(format!(
            "filters[].events must include at most {MAX_FILTER_EVENTS} entries"
        )));
    }

    if !events.iter().all(|event| validate_filter_value(event)) {
        return Err(WebhookError::BadRequest(format!(
            "filters[].events entries must be non-empty strings at most {MAX_FILTER_VALUE_LEN} characters"
        )));
    }

    Ok(())
}

fn validate_filter_ids(ids: &[String]) -> Result<(), WebhookError> {
    if ids.is_empty() {
        return Err(WebhookError::BadRequest(
            "filters[].ids must be a non-empty array of strings when present".to_string(),
        ));
    }

    if ids.len() > MAX_FILTER_IDS {
        return Err(WebhookError::BadRequest(format!(
            "filters[].ids must include at most {MAX_FILTER_IDS} entries"
        )));
    }

    if !ids.iter().all(|id| validate_filter_value(id)) {
        return Err(WebhookError::BadRequest(format!(
            "filters[].ids entries must be non-empty strings at most {MAX_FILTER_VALUE_LEN} characters"
        )));
    }

    Ok(())
}

fn validate_filters(filters: &WebhookFilters) -> Result<(), WebhookError> {
    if filters.is_empty() {
        return Err(WebhookError::BadRequest(
            "filters must be a non-empty array".to_string(),
        ));
    }

    if filters.len() > MAX_FILTERS {
        return Err(WebhookError::BadRequest(format!(
            "filters must include at most {MAX_FILTERS} entries"
        )));
    }

    for filter in filters {
        validate_filter_events(&filter.events)?;
        if let Some(ids) = &filter.ids {
            validate_filter_ids(ids)?;
        }
    }

    Ok(())
}

fn validate_create_request(
    request: &CreateWebhookRequest,
    endpoint_scheme_policy: WebhookEndpointSchemePolicy,
) -> Result<(), WebhookError> {
    validate_name(&request.name)?;
    validate_endpoint_url(&request.endpoint_url, endpoint_scheme_policy)?;
    validate_filters(&request.filters)
}

fn validate_patch_request(
    request: &PatchWebhookRequest,
    endpoint_scheme_policy: WebhookEndpointSchemePolicy,
) -> Result<(), WebhookError> {
    if let Some(name) = &request.name {
        validate_name(name)?;
    }
    if let Some(endpoint_url) = &request.endpoint_url {
        validate_endpoint_url(endpoint_url, endpoint_scheme_policy)?;
    }
    if let Some(filters) = &request.filters {
        validate_filters(filters)?;
    }
    Ok(())
}

fn webhook_is_missing(webhook: &Webhook) -> bool {
    webhook.deleted_at.is_some()
}

fn generate_signing_secret(caller: &MacroUserIdStr<'_>) -> String {
    format!(
        "whsec_{}_{}",
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
    async fn workspace_id_for_scope(
        &self,
        caller: MacroUserIdStr<'static>,
        scope: WebhookScope,
    ) -> Result<String, WebhookError> {
        match scope {
            WebhookScope::User => Ok(caller.as_ref().to_string()),
            WebhookScope::Team => self
                .repo
                .get_user_team_workspace_id(caller)
                .await
                .map_err(|err| WebhookError::Repo(err.into()))?
                .ok_or_else(|| {
                    WebhookError::BadRequest(
                        "team scope requires the user to belong to a team".to_string(),
                    )
                }),
        }
    }

    async fn caller_owns_workspace(
        &self,
        caller: MacroUserIdStr<'static>,
        workspace_id: &str,
    ) -> Result<bool, WebhookError> {
        if workspace_id == caller.as_ref() {
            return Ok(true);
        }

        let team_workspace_id = self
            .repo
            .get_user_team_workspace_id(caller)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?;

        Ok(team_workspace_id.as_deref() == Some(workspace_id))
    }

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
            .caller_owns_workspace(caller, &webhook.workspace_id)
            .await?
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
        validate_create_request(&request, self.endpoint_scheme_policy)?;

        let workspace_id = self
            .workspace_id_for_scope(caller.clone(), request.scope)
            .await?;

        let signing_secret = generate_signing_secret(&caller);
        let headers = serde_json::to_value(request.headers.clone().unwrap_or_default())
            .map_err(|err| WebhookError::Repo(err.into()))?;
        let mut webhook = self
            .repo
            .create_webhook(caller, workspace_id, request, signing_secret, headers)
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
        validate_patch_request(&request, self.endpoint_scheme_policy)?;
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

    async fn delete_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> Result<(), WebhookError> {
        let webhook = self
            .load_authorized_webhook(caller, webhook_id.clone())
            .await?;

        self.repo
            .delete_webhook(webhook.id)
            .await
            .map_err(|err| WebhookError::Repo(err.into()))?
            .ok_or_else(|| WebhookError::NotFound("webhook not found".to_string()))?;

        Ok(())
    }
}

/// Test event name used by validation adapters.
pub const fn validation_event_name() -> &'static str {
    VALIDATION_EVENT_NAME
}
