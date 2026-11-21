//! Signed POSTs to MCP Events callback endpoints: the verification
//! challenge and event deliveries.

#[cfg(test)]
#[path = "http_mcp_endpoint_test.rs"]
mod test;

use super::http_validator::{
    EndpointValidationError, ReqwestWebhookValidationClient, validate_resolved_endpoint_url,
};
use crate::domain::mcp::models::{
    McpControlEnvelope, McpDeliveryOutcome, McpEndpointFailure, McpSubscriptionId,
};
use crate::domain::mcp::ports::{McpEndpointClient, McpEndpointVerifyError};
use reqwest::{Response, StatusCode, Url, header::CONTENT_TYPE};
use subtle::ConstantTimeEq as _;
use webhook_signature::standard::{ID_HEADER, SIGNATURE_HEADER, SigningSecret, TIMESTAMP_HEADER};

/// Carries the subscription id so a receiver can pick the secret before
/// parsing the body.
const SUBSCRIPTION_ID_HEADER: &str = "x-mcp-subscription-id";

/// The most of a verification response read for the echoed challenge.
const CHALLENGE_RESPONSE_MAX_BYTES: usize = 4096;

/// A receiver that answers one of these wants no retry of that delivery.
const NON_RETRYABLE_STATUSES: [StatusCode; 2] = [StatusCode::GONE, StatusCode::PAYLOAD_TOO_LARGE];

#[derive(serde::Deserialize)]
struct ChallengeEcho {
    challenge: String,
}

/// 148 random bits from two UUIDv7s, unguessable by the endpoint.
fn new_challenge() -> String {
    format!(
        "{}{}",
        uuid::Uuid::now_v7().simple(),
        uuid::Uuid::now_v7().simple()
    )
}

fn verification_message_id() -> String {
    format!("msg_verification_{}", uuid::Uuid::now_v7().simple())
}

/// Classify a request that got no response.
fn transport_failure(error: &reqwest::Error) -> McpEndpointFailure {
    if error.is_timeout() {
        return McpEndpointFailure::Timeout;
    }
    // reqwest does not type TLS failures; the cause chain names them.
    let mut source: Option<&dyn std::error::Error> = Some(error);
    while let Some(cause) = source {
        let text = cause.to_string().to_ascii_lowercase();
        if text.contains("certificate") || text.contains("tls") || text.contains("handshake") {
            return McpEndpointFailure::TlsError;
        }
        source = cause.source();
    }
    McpEndpointFailure::ConnectionRefused
}

fn status_failure(status: StatusCode) -> McpEndpointFailure {
    if status.is_server_error() {
        McpEndpointFailure::Http5xx
    } else {
        McpEndpointFailure::Http4xx
    }
}

/// Read at most `limit` bytes of the body; `None` when it is longer.
async fn bounded_body(mut response: Response, limit: usize) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if body.len() + chunk.len() > limit {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

impl ReqwestWebhookValidationClient {
    async fn resolve(&self, endpoint_url: &str) -> Result<Url, EndpointValidationError> {
        validate_resolved_endpoint_url(
            endpoint_url,
            self.endpoint_scheme_policy,
            self.resolver.as_ref(),
        )
        .await
    }

    async fn post_signed(
        &self,
        url: Url,
        secret: &SigningSecret,
        subscription_id: &McpSubscriptionId,
        message_id: &str,
        body: Vec<u8>,
    ) -> Result<Response, McpEndpointFailure> {
        let timestamp = chrono::Utc::now().timestamp();
        // HMAC-SHA256 takes any key length, so this never fails in practice;
        // a refusal still must not send an unsigned request.
        let signature = secret
            .sign(message_id, timestamp, &body)
            .ok_or(McpEndpointFailure::ConnectionRefused)?;
        let request = self
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(ID_HEADER, message_id)
            .header(TIMESTAMP_HEADER, timestamp.to_string())
            .header(SIGNATURE_HEADER, signature)
            .header(SUBSCRIPTION_ID_HEADER, subscription_id.as_str())
            .body(body);
        request
            .send()
            .await
            .map_err(|error| transport_failure(&error))
    }
}

impl McpEndpointClient for ReqwestWebhookValidationClient {
    #[tracing::instrument(
        name = "mcp_events.verify_endpoint",
        skip_all,
        fields(subscription_id = %subscription_id, status = tracing::field::Empty),
        err
    )]
    async fn verify(
        &self,
        endpoint_url: &str,
        secret: &SigningSecret,
        subscription_id: &McpSubscriptionId,
    ) -> Result<(), McpEndpointVerifyError> {
        let url = self
            .resolve(endpoint_url)
            .await
            .map_err(|error| match error {
                EndpointValidationError::InvalidConfiguration(message) => {
                    McpEndpointVerifyError::InvalidUrl(message)
                }
                EndpointValidationError::ResolutionFailure(_) => {
                    McpEndpointVerifyError::Failed(McpEndpointFailure::ConnectionRefused)
                }
            })?;
        let challenge = new_challenge();
        let body = serde_json::to_vec(&McpControlEnvelope::Verification {
            challenge: challenge.clone(),
        })
        .map_err(|_| McpEndpointVerifyError::Failed(McpEndpointFailure::ChallengeFailed))?;
        let response = self
            .post_signed(
                url,
                secret,
                subscription_id,
                &verification_message_id(),
                body,
            )
            .await
            .map_err(McpEndpointVerifyError::Failed)?;
        let status = response.status();
        tracing::Span::current().record("status", status.as_u16());
        if !status.is_success() {
            return Err(McpEndpointVerifyError::Failed(status_failure(status)));
        }
        let echoed = bounded_body(response, CHALLENGE_RESPONSE_MAX_BYTES)
            .await
            .and_then(|body| serde_json::from_slice::<ChallengeEcho>(&body).ok())
            .map(|echo| echo.challenge);
        match echoed {
            Some(echoed) if bool::from(echoed.as_bytes().ct_eq(challenge.as_bytes())) => Ok(()),
            _ => Err(McpEndpointVerifyError::Failed(
                McpEndpointFailure::ChallengeFailed,
            )),
        }
    }

    #[tracing::instrument(
        name = "mcp_events.post_delivery",
        skip_all,
        fields(subscription_id = %subscription_id, message_id, status = tracing::field::Empty)
    )]
    async fn deliver(
        &self,
        endpoint_url: &str,
        secret: &SigningSecret,
        subscription_id: &McpSubscriptionId,
        message_id: &str,
        body: Vec<u8>,
    ) -> McpDeliveryOutcome {
        let url = match self.resolve(endpoint_url).await {
            Ok(url) => url,
            // The URL passed these checks at subscribe time; a host that now
            // resolves somewhere we do not call will not get better.
            Err(EndpointValidationError::InvalidConfiguration(_)) => {
                return McpDeliveryOutcome::Permanent;
            }
            Err(EndpointValidationError::ResolutionFailure(_)) => {
                return McpDeliveryOutcome::Retryable(McpEndpointFailure::ConnectionRefused);
            }
        };
        let response = match self
            .post_signed(url, secret, subscription_id, message_id, body)
            .await
        {
            Ok(response) => response,
            Err(failure) => return McpDeliveryOutcome::Retryable(failure),
        };
        let status = response.status();
        tracing::Span::current().record("status", status.as_u16());
        if status.is_success() {
            McpDeliveryOutcome::Delivered
        } else if NON_RETRYABLE_STATUSES.contains(&status) {
            McpDeliveryOutcome::Permanent
        } else {
            McpDeliveryOutcome::Retryable(status_failure(status))
        }
    }
}
