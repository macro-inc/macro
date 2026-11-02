//! Bounded internal transport for agent session creation.

use std::{future::Future, pin::Pin, time::Duration};

use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Response, StatusCode, Url, header::HeaderValue};
use serde::{Serialize, de::DeserializeOwned};

use crate::domain::coding_agents::{
    CodingAgentError, CodingAgentService, DispatchCodingAgentRequest, DispatchedCodingAgent,
};
use crate::domain::updates::AgentUpdates;

const CREATE_TIMEOUT: Duration = Duration::from_secs(120);
const UPDATES_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Operation {
    Updates,
    Create,
}

impl Operation {
    fn path(self) -> &'static str {
        match self {
            Self::Updates => "internal/coding-agents/updates",
            Self::Create => "internal/coding-agents/create-session",
        }
    }

    fn timeout(self) -> Duration {
        match self {
            Self::Updates => UPDATES_TIMEOUT,
            Self::Create => CREATE_TIMEOUT,
        }
    }

    fn uncertain_error(self) -> CodingAgentError {
        match self {
            Self::Updates => CodingAgentError::OperationFailed,
            Self::Create => CodingAgentError::DispatchDeliveryUnknown,
        }
    }
}

/// Internal service client that never redirects credentials or retries creation.
#[derive(Clone)]
pub struct CodingAgentsClient {
    pub(super) client: Client,
    pub(super) base_url: Url,
    pub(super) internal_key: HeaderValue,
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
            .timeout(CREATE_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()?;
        Ok(Self {
            client,
            base_url,
            internal_key,
        })
    }

    #[tracing::instrument(name = "agent_session.command", skip_all, fields(operation = ?operation), err)]
    async fn command<T: DeserializeOwned>(
        &self,
        operation: Operation,
        command: &impl Serialize,
        acting_user: Option<&MacroUserIdStr<'static>>,
    ) -> Result<T, CodingAgentError> {
        // Anything short of a well-formed answer may follow an admitted prompt.
        let uncertain = || operation.uncertain_error();
        let url = self
            .base_url
            .join(operation.path())
            .map_err(|_| CodingAgentError::OperationFailed)?;
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let builder = if operation == Operation::Updates {
            self.client.get(url).header(
                INTERNAL_MACRO_USER_ID_HEADER,
                acting_user
                    .ok_or(CodingAgentError::InvalidCommand)?
                    .as_ref(),
            )
        } else {
            self.client.post(url).json(command)
        };
        let response = builder
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, self.internal_key.clone())
            .timeout(operation.timeout())
            .send()
            .await
            .map_err(|_| uncertain())?;
        let status = response.status();
        let body = bounded_body(response).await.map_err(|_| uncertain())?;
        if status.is_success() {
            return serde_json::from_slice(&body).map_err(|_| uncertain());
        }
        if let Ok(error) = serde_json::from_slice::<CodingAgentError>(&body) {
            let valid_status = match &error {
                CodingAgentError::InvalidCommand | CodingAgentError::InvalidPrompt => {
                    status == StatusCode::BAD_REQUEST
                }
                CodingAgentError::Forbidden => status == StatusCode::FORBIDDEN,
                CodingAgentError::Unavailable => status == StatusCode::NOT_FOUND,
                CodingAgentError::OperationFailed => {
                    status == StatusCode::INTERNAL_SERVER_ERROR
                        || (operation == Operation::Updates
                            && status == StatusCode::GATEWAY_TIMEOUT)
                }
                CodingAgentError::DispatchFailed { .. } => status == StatusCode::BAD_GATEWAY,
                CodingAgentError::DispatchDeliveryUnknown => {
                    status == StatusCode::BAD_GATEWAY
                        || (operation == Operation::Create && status == StatusCode::GATEWAY_TIMEOUT)
                }
            };
            // A contradictory envelope is not evidence that creation was refused.
            return Err(if valid_status { error } else { uncertain() });
        }
        // Never expose gateway/provider bodies, which may contain private content.
        Err(match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => CodingAgentError::Forbidden,
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
                CodingAgentError::InvalidCommand
            }
            _ => uncertain(),
        })
    }
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
    fn list_updates(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentUpdates, CodingAgentError>> + Send + '_>> {
        Box::pin(async move { self.command(Operation::Updates, &(), Some(&user_id)).await })
    }
    fn create(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>
    {
        Box::pin(async move { self.command(Operation::Create, &command, None).await })
    }
}

#[cfg(test)]
mod test;
