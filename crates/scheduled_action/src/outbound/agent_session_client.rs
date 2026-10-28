//! Bounded internal transport for the session domain's routine capability.

use std::time::Duration;

use agent_session::domain::routines::{
    PrepareRoutineSession, PreparedRoutineSession, PromptRoutineSession, RoutineActionStatus,
    RoutinePromptAccepted, RoutineSessionAction, RoutineSessionError, RoutineSessions,
    ValidateRoutineSession, ValidatedRoutineSession,
};
use anyhow::{Context, Result};
use macro_authorization::INTERNAL_API_KEY_HEADER;
use reqwest::{Client, Response, StatusCode, Url, header::HeaderValue};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    Validate,
    Prepare,
    Prompt,
    Status,
    Cancel,
}

impl Operation {
    fn path(self) -> &'static str {
        match self {
            Self::Validate => "internal/routine-sessions/validate",
            Self::Prepare => "internal/routine-sessions/prepare",
            Self::Prompt => "internal/routine-sessions/prompt",
            Self::Status => "internal/routine-sessions/status",
            Self::Cancel => "internal/routine-sessions/cancel",
        }
    }

    fn timeout(self) -> Duration {
        match self {
            Self::Status | Self::Cancel => SNAPSHOT_TIMEOUT,
            _ => REQUEST_TIMEOUT,
        }
    }

    fn uncertain_error(self) -> RoutineSessionError {
        if self == Self::Prompt {
            RoutineSessionError::PromptDeliveryUnknown
        } else {
            RoutineSessionError::OperationFailed
        }
    }
}

/// No user credentials, runtime provisioning, usage accounting, or execution retries.
#[derive(Clone)]
pub struct AgentSessionClient {
    client: Client,
    base_url: Url,
    internal_key: HeaderValue,
}

impl AgentSessionClient {
    /// Accepts either a service root or its `/agent-harness` prefix.
    pub fn new(base_url: &str, internal_api_key: &str) -> Result<Self> {
        let base_url = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))
            .context("invalid agent harness service URL")?;
        anyhow::ensure!(
            matches!(base_url.scheme(), "http" | "https")
                && base_url.host_str().is_some()
                && base_url.username().is_empty()
                && base_url.password().is_none()
                && base_url.query().is_none()
                && base_url.fragment().is_none(),
            "expected an HTTP agent harness service base URL"
        );
        anyhow::ensure!(
            !internal_api_key.trim().is_empty(),
            "internal API key is required"
        );
        let mut internal_key =
            HeaderValue::from_str(internal_api_key).context("invalid internal API key header")?;
        internal_key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            // Never forward the secret or replay a mutating command on redirects
            // or reqwest's automatic protocol-level retry path.
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self {
            client,
            base_url,
            internal_key,
        })
    }

    async fn send(
        &self,
        operation: Operation,
        command: &impl Serialize,
    ) -> Result<Response, RoutineSessionError> {
        let url = self
            .base_url
            .join(operation.path())
            .map_err(|_| RoutineSessionError::OperationFailed)?;
        let response = self
            .client
            .post(url)
            .header(INTERNAL_API_KEY_HEADER, self.internal_key.clone())
            .timeout(operation.timeout())
            .json(command)
            .send()
            .await
            .map_err(|_| operation.uncertain_error())?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let body = bounded_body(response).await;
        if let Ok(body) = body
            && let Ok(error) = serde_json::from_slice::<ErrorResponse>(&body)
        {
            return Err(error.code);
        }
        // Authentication/proxy failures may not use the domain error envelope.
        // Never return their body (which may contain credentials or content).
        let error = match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => RoutineSessionError::Forbidden,
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
                RoutineSessionError::InvalidCommand
            }
            _ if operation == Operation::Prompt => RoutineSessionError::PromptDeliveryUnknown,
            StatusCode::CONFLICT => RoutineSessionError::Conflict,
            StatusCode::NOT_FOUND
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT => RoutineSessionError::RuntimeUnavailable,
            _ => RoutineSessionError::OperationFailed,
        };
        Err(error)
    }

    async fn command<T: DeserializeOwned>(
        &self,
        operation: Operation,
        command: &impl Serialize,
    ) -> Result<T, RoutineSessionError> {
        let response = self.send(operation, command).await?;
        let body = bounded_body(response)
            .await
            .map_err(|_| operation.uncertain_error())?;
        serde_json::from_slice(&body).map_err(|_| operation.uncertain_error())
    }
}

#[derive(Deserialize)]
struct ErrorResponse {
    code: RoutineSessionError,
}

async fn bounded_body(mut response: Response) -> Result<Vec<u8>, RoutineSessionError> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| RoutineSessionError::OperationFailed)?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(RoutineSessionError::OperationFailed);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

impl RoutineSessions for AgentSessionClient {
    async fn validate(
        &self,
        command: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        self.command(Operation::Validate, &command).await
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        self.command(Operation::Prepare, &command).await
    }

    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        self.command(Operation::Prompt, &command).await
    }

    async fn status(
        &self,
        command: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        self.command(Operation::Status, &command).await
    }

    async fn cancel(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.send(Operation::Cancel, &command).await?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
