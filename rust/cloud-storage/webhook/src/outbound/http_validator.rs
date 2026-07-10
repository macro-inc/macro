//! HTTP webhook validation client.

#[cfg(test)]
#[path = "http_validator_test.rs"]
mod http_validator_test;

use crate::domain::{
    models::{Webhook, WebhookValidationResult},
    ports::WebhookValidationClient,
};
use hmac::{Hmac, Mac};
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde_json::json;
use sha2::Sha256;
use std::{net::IpAddr, time::Duration};
use tokio::net::lookup_host;

const EVENT_NAME: &str = "webhook.validation.test";
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

type HmacSha256 = Hmac<Sha256>;

/// Reqwest-backed implementation of [`WebhookValidationClient`].
#[derive(Clone)]
pub struct ReqwestWebhookValidationClient {
    pub(super) client: Client,
}

impl ReqwestWebhookValidationClient {
    /// Create a validation client with the required webhook delivery limits.
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(Policy::none())
            .build()?;

        Ok(Self { client })
    }
}

impl WebhookValidationClient for ReqwestWebhookValidationClient {
    type Err = anyhow::Error;

    async fn validate_webhook(
        &self,
        webhook: Webhook,
    ) -> Result<WebhookValidationResult, Self::Err> {
        let url = match validate_resolved_endpoint_url(&webhook.endpoint_url).await {
            Ok(url) => url,
            Err(error) => return Ok(failure(None, error.message())),
        };

        let event_id = new_validation_event_id();
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let body = validation_body(&webhook.id, &event_id)?;
        let signature = signature_header(&webhook.signing_secret, &timestamp, &body)?;

        let mut request = self
            .client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header("X-Macro-Event", EVENT_NAME)
            .header("X-Macro-Event-Id", event_id)
            .header("X-Macro-Timestamp", &timestamp)
            .header("X-Macro-Signature", signature);

        for (name, value) in webhook.headers {
            if is_reserved_macro_header(&name) {
                return Ok(failure(None, "reserved Macro headers cannot be overridden"));
            }
            request = request.header(name, value);
        }

        let response = match request.body(body).send().await {
            Ok(response) => response,
            Err(error) if error.is_timeout() => {
                return Ok(failure(None, "validation timed out after 5 seconds"));
            }
            Err(_) => return Ok(failure(None, "webhook endpoint could not be reached")),
        };

        let status = response.status();
        if status.is_success() {
            return Ok(WebhookValidationResult {
                is_valid: true,
                response_status: Some(status.as_u16()),
                message: None,
            });
        }

        Ok(failure(
            Some(status),
            format!("webhook returned HTTP {}", status.as_u16()),
        ))
    }
}

fn new_validation_event_id() -> String {
    format!("evt_{}", macro_uuid::generate_uuid_v7())
}

fn validation_body(webhook_id: &str, event_id: &str) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&json!({
        "id": event_id,
        "event": EVENT_NAME,
        "webhook_id": webhook_id,
    }))
}

pub(super) fn signature_header(
    secret: &str,
    timestamp: &str,
    raw_body: &[u8],
) -> Result<String, anyhow::Error> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())?;
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(raw_body);
    Ok(format!("v1={}", hex::encode(mac.finalize().into_bytes())))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EndpointValidationError {
    InvalidConfiguration(&'static str),
    ResolutionFailure(&'static str),
}

impl EndpointValidationError {
    pub(super) const fn message(self) -> &'static str {
        match self {
            Self::InvalidConfiguration(message) | Self::ResolutionFailure(message) => message,
        }
    }

    pub(super) const fn is_retryable(self) -> bool {
        matches!(self, Self::ResolutionFailure(_))
    }
}

pub(super) async fn validate_resolved_endpoint_url(
    value: &str,
) -> Result<Url, EndpointValidationError> {
    let url = validate_endpoint_url(value)?;
    let Some(host) = url.host_str().map(str::to_owned) else {
        return Err(EndpointValidationError::InvalidConfiguration(
            "webhook endpoint URL host is invalid",
        ));
    };
    let Some(port) = url.port_or_known_default() else {
        return Err(EndpointValidationError::InvalidConfiguration(
            "webhook endpoint URL port is invalid",
        ));
    };

    let mut resolved = lookup_host((host.as_str(), port)).await.map_err(|_| {
        EndpointValidationError::ResolutionFailure("webhook endpoint host could not be resolved")
    })?;
    let mut saw_address = false;
    for address in resolved.by_ref() {
        saw_address = true;
        if is_blocked_ip(address.ip()) {
            return Err(EndpointValidationError::InvalidConfiguration(
                "webhook endpoint host resolves to a disallowed address",
            ));
        }
    }

    if !saw_address {
        return Err(EndpointValidationError::ResolutionFailure(
            "webhook endpoint host could not be resolved",
        ));
    }

    Ok(url)
}

fn validate_endpoint_url(value: &str) -> Result<Url, EndpointValidationError> {
    let url = Url::parse(value).map_err(|_| {
        EndpointValidationError::InvalidConfiguration("webhook endpoint URL is invalid")
    })?;
    if url.scheme() != "https" {
        return Err(EndpointValidationError::InvalidConfiguration(
            "webhook endpoint URL must use HTTPS",
        ));
    }

    let Some(host) = url.host_str() else {
        return Err(EndpointValidationError::InvalidConfiguration(
            "webhook endpoint URL host is invalid",
        ));
    };

    if is_blocked_host(host) {
        return Err(EndpointValidationError::InvalidConfiguration(
            "webhook endpoint host is not allowed",
        ));
    }

    Ok(url)
}

fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }

    host.parse::<IpAddr>().is_ok_and(is_blocked_ip)
}

fn is_blocked_ip(ip: IpAddr) -> bool {
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

pub(super) fn is_reserved_macro_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "x-macro-event" | "x-macro-event-id" | "x-macro-timestamp" | "x-macro-signature"
    )
}

fn failure(status: Option<StatusCode>, message: impl Into<String>) -> WebhookValidationResult {
    WebhookValidationResult {
        is_valid: false,
        response_status: status.map(|status| status.as_u16()),
        message: Some(message.into()),
    }
}
