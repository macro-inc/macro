//! Bounded internal transport for coding agent discovery and dispatch.

use std::{future::Future, pin::Pin, time::Duration};

use macro_authorization::INTERNAL_API_KEY_HEADER;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Response, StatusCode, Url, header::HeaderValue};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::coding_agents::{
    CodingAgent, CodingAgentError, CodingAgentService, DispatchCodingAgentRequest,
    DispatchedCodingAgent,
};

const DISPATCH_TIMEOUT: Duration = Duration::from_secs(120);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    List,
    Dispatch,
}

impl Operation {
    fn path(self) -> &'static str {
        match self {
            Self::List => "internal/coding-agents/list",
            Self::Dispatch => "internal/coding-agents/dispatch",
        }
    }

    fn timeout(self) -> Duration {
        match self {
            Self::List => LIST_TIMEOUT,
            Self::Dispatch => DISPATCH_TIMEOUT,
        }
    }

    fn uncertain_error(self) -> CodingAgentError {
        match self {
            Self::List => CodingAgentError::OperationFailed,
            Self::Dispatch => CodingAgentError::DispatchDeliveryUnknown,
        }
    }
}

/// Internal service client that never redirects credentials or retries dispatch.
#[derive(Clone)]
pub struct CodingAgentsClient {
    client: Client,
    base_url: Url,
    internal_key: HeaderValue,
}

impl CodingAgentsClient {
    /// Accept either the service root or its `/agent-harness` gateway prefix.
    pub fn new(base_url: &str, internal_api_key: &str) -> rootcause::Result<Self> {
        let base_url = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            rootcause::bail!("expected an HTTP agent harness service base URL");
        }
        if internal_api_key.trim().is_empty() {
            rootcause::bail!("internal API key is required");
        }
        let mut internal_key = HeaderValue::from_str(internal_api_key)?;
        internal_key.set_sensitive(true);
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DISPATCH_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self {
            client,
            base_url,
            internal_key,
        })
    }

    async fn command<T: DeserializeOwned>(
        &self,
        operation: Operation,
        command: &impl Serialize,
    ) -> Result<T, CodingAgentError> {
        let url = self
            .base_url
            .join(operation.path())
            .map_err(|_| CodingAgentError::OperationFailed)?;
        let response = self
            .client
            .post(url)
            .header(INTERNAL_API_KEY_HEADER, self.internal_key.clone())
            .timeout(operation.timeout())
            .json(command)
            .send()
            .await
            .map_err(|_| operation.uncertain_error())?;
        let status = response.status();
        let body = bounded_body(response)
            .await
            .map_err(|_| operation.uncertain_error())?;
        if status.is_success() {
            return serde_json::from_slice(&body).map_err(|_| operation.uncertain_error());
        }
        if let Ok(error) = serde_json::from_slice::<CodingAgentError>(&body) {
            let valid_status = match &error {
                CodingAgentError::InvalidCommand
                | CodingAgentError::InvalidPrompt
                | CodingAgentError::AmbiguousAgent => status == StatusCode::BAD_REQUEST,
                CodingAgentError::Forbidden => status == StatusCode::FORBIDDEN,
                CodingAgentError::Unavailable => status == StatusCode::NOT_FOUND,
                CodingAgentError::OperationFailed => {
                    status == StatusCode::INTERNAL_SERVER_ERROR
                        || (operation == Operation::List && status == StatusCode::GATEWAY_TIMEOUT)
                }
                CodingAgentError::DispatchFailed { .. } => status == StatusCode::BAD_GATEWAY,
                CodingAgentError::DispatchDeliveryUnknown => {
                    status == StatusCode::BAD_GATEWAY
                        || (operation == Operation::Dispatch
                            && status == StatusCode::GATEWAY_TIMEOUT)
                }
            };
            // A contradictory envelope is not evidence that dispatch was refused.
            return Err(if valid_status {
                error
            } else {
                operation.uncertain_error()
            });
        }
        // Never expose gateway/provider bodies, which may contain private content.
        Err(match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => CodingAgentError::Forbidden,
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
                CodingAgentError::InvalidCommand
            }
            _ => operation.uncertain_error(),
        })
    }
}

#[derive(Serialize)]
struct ListRequest {
    user_id: MacroUserIdStr<'static>,
}

#[derive(Deserialize)]
struct ListResponse {
    agents: Vec<CodingAgent>,
}

async fn bounded_body(mut response: Response) -> Result<Vec<u8>, CodingAgentError> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| CodingAgentError::OperationFailed)?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(CodingAgentError::OperationFailed);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

impl CodingAgentService for CodingAgentsClient {
    fn list(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<CodingAgent>, CodingAgentError>> + Send + '_>> {
        Box::pin(async move {
            let response: ListResponse = self
                .command(Operation::List, &ListRequest { user_id })
                .await?;
            Ok(response.agents)
        })
    }

    fn dispatch(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>
    {
        Box::pin(async move { self.command(Operation::Dispatch, &command).await })
    }
}

#[cfg(test)]
mod test;
