//! Client for the harness's internal user-execution route, for hosts with no
//! Deno runtime of their own.

use crate::domain::{CodeModeError, MentionCodeMode, MentionContext, UserExecutionReceipt};
use crate::user_executions::{USER_EXECUTIONS_PATH, UserExecutionCommand, UserExecutionFailure};
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use macro_authorization::INTERNAL_API_KEY_HEADER;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Url, header::HeaderValue};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// The longest program deadline plus room for queueing and transport.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
/// A receipt carries one bounded program result.
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// Runs programs on the harness as a named user, with the internal key.
#[derive(Clone)]
pub struct HarnessUserExecutions {
    client: Client,
    endpoint: Url,
    internal_key: HeaderValue,
}

impl HarnessUserExecutions {
    /// Accept the harness service root or its gateway prefix.
    pub fn new(base_url: &str, internal_api_key: &str) -> rootcause::Result<Self> {
        let base = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))?;
        if !matches!(base.scheme(), "http" | "https")
            || base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            rootcause::bail!("expected an HTTP agent harness service base URL");
        }
        if internal_api_key.trim().is_empty() {
            rootcause::bail!("internal API key is required");
        }
        let endpoint = base.join(USER_EXECUTIONS_PATH.trim_start_matches('/'))?;
        let mut internal_key = HeaderValue::from_str(internal_api_key)?;
        internal_key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self {
            client,
            endpoint,
            internal_key,
        })
    }
}

#[async_trait]
impl MentionCodeMode for HarnessUserExecutions {
    /// Cancelling hangs up, which stops the program on the harness.
    #[tracing::instrument(
        name = "code_mode.harness_user_execution",
        skip_all,
        fields(message_id = %mention.message_id),
        err
    )]
    async fn execute(
        &self,
        user: &MacroUserIdStr<'static>,
        mention: &MentionContext,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError> {
        let command = UserExecutionCommand {
            user_id: user.clone(),
            mention: mention.clone(),
            source: request.source,
            timeout_ms: request.timeout_ms,
        };
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let send = self
            .client
            .post(self.endpoint.clone())
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, self.internal_key.clone())
            .json(&command)
            .send();
        let response = tokio::select! {
            response = send => response.map_err(|error| {
                tracing::warn!(error = ?error.without_url(), "harness user execution unreachable");
                // Only a refused connection proves the program never started.
                if error.is_connect() {
                    CodeModeError::Unavailable
                } else {
                    CodeModeError::Unconfirmed
                }
            })?,
            () = cancel.cancelled() => return Err(CodeModeError::Unconfirmed),
        };
        let status = response.status();
        let body = tokio::select! {
            body = bounded_body(response) => body?,
            () = cancel.cancelled() => return Err(CodeModeError::Unconfirmed),
        };
        if status.is_success() {
            return serde_json::from_slice(&body).map_err(|error| {
                tracing::warn!(error = ?error, "harness user execution receipt undecodable");
                CodeModeError::Unconfirmed
            });
        }
        // Only a failure envelope that agrees with its status is trusted.
        Err(
            match serde_json::from_slice::<UserExecutionFailure>(&body) {
                Ok(failure) if failure.status().as_u16() == status.as_u16() => failure.into(),
                // No route (the harness has no Deno runtime): nothing ran.
                _ if status == reqwest::StatusCode::NOT_FOUND => CodeModeError::Unavailable,
                _ => {
                    tracing::warn!(status = status.as_u16(), "harness user execution refused");
                    CodeModeError::Unconfirmed
                }
            },
        )
    }
}

async fn bounded_body(mut response: reqwest::Response) -> Result<Vec<u8>, CodeModeError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        tracing::warn!(error = ?error.without_url(), "harness user execution body unreadable");
        CodeModeError::Unconfirmed
    })? {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(CodeModeError::Unconfirmed);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
