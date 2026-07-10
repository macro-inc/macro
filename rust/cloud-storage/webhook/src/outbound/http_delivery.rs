//! Signed HTTP webhook delivery client.

#[cfg(test)]
#[path = "http_delivery_test.rs"]
mod http_delivery_test;

use super::http_validator::{
    EndpointValidationError, ReqwestWebhookValidationClient, is_reserved_macro_header,
    signature_header, validate_resolved_endpoint_url,
};
use crate::domain::{
    models::{
        NormalizedWebhookEvent, Webhook, WebhookHeaders, WebhookHttpOutcome,
        WebhookHttpOutcomeDetails,
    },
    ports::WebhookDeliveryClient,
};
use reqwest::{
    Client, Request, Response, StatusCode, Url,
    header::{CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue},
};
use std::time::{Duration, Instant};

const EVENT_HEADER: &str = "x-macro-event";
const EVENT_ID_HEADER: &str = "x-macro-event-id";
const TIMESTAMP_HEADER: &str = "x-macro-timestamp";
const SIGNATURE_HEADER: &str = "x-macro-signature";
const REDACTED_HEADER_VALUE: &str = "[REDACTED]";
const RESPONSE_PREVIEW_MAX_BYTES: usize = 4096;

/// Reqwest-backed implementation of [`WebhookDeliveryClient`].
///
/// This is the same cloneable, redirect-disabled client used for webhook
/// validation, so validation and production requests share one security policy.
pub type ReqwestWebhookDeliveryClient = ReqwestWebhookValidationClient;

impl WebhookDeliveryClient for ReqwestWebhookValidationClient {
    type Err = anyhow::Error;

    async fn deliver(
        &self,
        webhook: &Webhook,
        event: &NormalizedWebhookEvent,
    ) -> Result<WebhookHttpOutcome, Self::Err> {
        let started_at = Instant::now();
        let raw_body = serde_json::to_vec(&event.broker_envelope)?;
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let signature = signature_header(&webhook.signing_secret, &timestamp, &raw_body)?;
        let headers = match delivery_headers(webhook, event, &timestamp, &signature) {
            Ok(headers) => headers,
            Err(message) => {
                return Ok(WebhookHttpOutcome::PermanentFailure(
                    configuration_failure_details(
                        started_at.elapsed(),
                        "header_configuration",
                        message,
                    ),
                ));
            }
        };
        let url = match validate_resolved_endpoint_url(&webhook.endpoint_url).await {
            Ok(url) => url,
            Err(error) => return Ok(endpoint_failure(started_at.elapsed(), error)),
        };
        let request = match delivery_request(&self.client, url, headers, raw_body) {
            Ok(request) => request,
            Err(_) => {
                return Ok(WebhookHttpOutcome::PermanentFailure(
                    configuration_failure_details(
                        started_at.elapsed(),
                        "request_configuration",
                        "webhook request configuration is invalid",
                    ),
                ));
            }
        };

        let response = match self.client.execute(request).await {
            Ok(response) => response,
            Err(error) => {
                let details = transport_failure_details(started_at.elapsed(), &error);
                if error.is_builder() {
                    return Ok(WebhookHttpOutcome::PermanentFailure(details));
                }
                return Ok(WebhookHttpOutcome::RetryableFailure(details));
            }
        };

        Ok(response_outcome(response, started_at).await)
    }
}

fn delivery_headers(
    webhook: &Webhook,
    event: &NormalizedWebhookEvent,
    timestamp: &str,
    signature: &str,
) -> Result<HeaderMap, &'static str> {
    if webhook
        .headers
        .keys()
        .any(|name| is_reserved_macro_header(name))
    {
        return Err("reserved Macro headers cannot be overridden");
    }

    let mut headers = HeaderMap::new();
    for (name, value) in &webhook.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "custom webhook headers are invalid")?;
        let mut value =
            HeaderValue::from_str(value).map_err(|_| "custom webhook headers are invalid")?;
        value.set_sensitive(true);
        headers.insert(name, value);
    }

    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    insert_header(&mut headers, EVENT_HEADER, &event.event_name, false)?;
    insert_header(&mut headers, EVENT_ID_HEADER, &event.event_id, false)?;
    insert_header(&mut headers, TIMESTAMP_HEADER, timestamp, false)?;
    insert_header(&mut headers, SIGNATURE_HEADER, signature, true)?;

    Ok(headers)
}

fn insert_header(
    headers: &mut HeaderMap,
    name: &'static str,
    value: &str,
    sensitive: bool,
) -> Result<(), &'static str> {
    let mut value =
        HeaderValue::from_str(value).map_err(|_| "webhook event headers are invalid")?;
    value.set_sensitive(sensitive);
    headers.insert(HeaderName::from_static(name), value);
    Ok(())
}

fn delivery_request(
    client: &Client,
    url: Url,
    headers: HeaderMap,
    raw_body: Vec<u8>,
) -> Result<Request, reqwest::Error> {
    client.post(url).headers(headers).body(raw_body).build()
}

async fn response_outcome(mut response: Response, started_at: Instant) -> WebhookHttpOutcome {
    let status = response.status();
    let response_headers_redacted = Some(redacted_headers(response.headers()));
    let (response_body_preview, preview_error) = read_response_preview(&mut response).await;
    let duration = started_at.elapsed();

    let (error_kind, error_message) = match preview_error {
        Some(error) if error.is_timeout() => (
            Some("response_timeout".to_string()),
            Some("webhook response preview timed out".to_string()),
        ),
        Some(_) => (
            Some("response_read".to_string()),
            Some("webhook response preview could not be read".to_string()),
        ),
        None if !status.is_success() => (
            Some("http_status".to_string()),
            Some(format!("webhook returned HTTP {}", status.as_u16())),
        ),
        None => (None, None),
    };

    classify_http_status(
        status,
        WebhookHttpOutcomeDetails {
            duration,
            response_status: Some(status.as_u16()),
            response_headers_redacted,
            response_body_preview: Some(response_body_preview),
            error_kind,
            error_message,
        },
    )
}

fn classify_http_status(
    status: StatusCode,
    details: WebhookHttpOutcomeDetails,
) -> WebhookHttpOutcome {
    if status.is_success() {
        return WebhookHttpOutcome::Success(details);
    }

    if status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
    {
        return WebhookHttpOutcome::RetryableFailure(details);
    }

    WebhookHttpOutcome::PermanentFailure(details)
}

async fn read_response_preview(response: &mut Response) -> (String, Option<reqwest::Error>) {
    let mut preview = Vec::new();
    while preview.len() < RESPONSE_PREVIEW_MAX_BYTES {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = RESPONSE_PREVIEW_MAX_BYTES - preview.len();
                preview.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            }
            Ok(None) => break,
            Err(error) => return (utf8_lossy_preview(&preview), Some(error)),
        }
    }

    (utf8_lossy_preview(&preview), None)
}

fn utf8_lossy_preview(bytes: &[u8]) -> String {
    let bytes = &bytes[..bytes.len().min(RESPONSE_PREVIEW_MAX_BYTES)];
    let mut preview = String::from_utf8_lossy(bytes).into_owned();
    if preview.len() > RESPONSE_PREVIEW_MAX_BYTES {
        let mut end = RESPONSE_PREVIEW_MAX_BYTES;
        while !preview.is_char_boundary(end) {
            end -= 1;
        }
        preview.truncate(end);
    }
    preview
}

fn redacted_headers(headers: &HeaderMap) -> WebhookHeaders {
    headers
        .keys()
        .map(|name| (name.as_str().to_string(), REDACTED_HEADER_VALUE.to_string()))
        .collect()
}

fn endpoint_failure(duration: Duration, error: EndpointValidationError) -> WebhookHttpOutcome {
    let details = configuration_failure_details(
        duration,
        if error.is_retryable() {
            "dns_resolution"
        } else {
            "endpoint_configuration"
        },
        error.message(),
    );

    if error.is_retryable() {
        WebhookHttpOutcome::RetryableFailure(details)
    } else {
        WebhookHttpOutcome::PermanentFailure(details)
    }
}

fn configuration_failure_details(
    duration: Duration,
    error_kind: &str,
    error_message: &str,
) -> WebhookHttpOutcomeDetails {
    WebhookHttpOutcomeDetails {
        duration,
        response_status: None,
        response_headers_redacted: None,
        response_body_preview: None,
        error_kind: Some(error_kind.to_string()),
        error_message: Some(error_message.to_string()),
    }
}

fn transport_failure_details(
    duration: Duration,
    error: &reqwest::Error,
) -> WebhookHttpOutcomeDetails {
    let (error_kind, error_message) = if error.is_timeout() {
        ("timeout", "webhook delivery timed out after 5 seconds")
    } else if error.is_builder() {
        (
            "request_configuration",
            "webhook request configuration is invalid",
        )
    } else {
        ("network", "webhook endpoint could not be reached")
    };

    WebhookHttpOutcomeDetails {
        duration,
        response_status: None,
        response_headers_redacted: None,
        response_body_preview: None,
        error_kind: Some(error_kind.to_string()),
        error_message: Some(error_message.to_string()),
    }
}
