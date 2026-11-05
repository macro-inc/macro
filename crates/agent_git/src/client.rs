//! Client for the internal API, for services that create and delete agents.

use std::time::Duration;

use macro_authorization::INTERNAL_API_KEY_HEADER;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;
use uuid::Uuid;

use crate::api::{CreateRepoRequest, CreatedRepoResponse};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Errors from [`AgentGitClient`].
#[derive(Debug, thiserror::Error)]
pub enum AgentGitClientError {
    /// The request did not complete.
    #[error("agent git request failed: {0}")]
    Request(#[from] reqwest::Error),
    /// The agent already has a repo for another team.
    #[error("the agent's repo belongs to another team")]
    TeamMismatch,
    /// Any other non-success status.
    #[error("agent git service answered {status}: {body}")]
    Status {
        /// The status.
        status: StatusCode,
        /// The response body.
        body: String,
    },
}

/// Calls `agent_git_service`'s internal API.
#[derive(Clone)]
pub struct AgentGitClient {
    http: reqwest::Client,
    base_url: String,
    internal_api_key: String,
}

impl AgentGitClient {
    /// `base_url` is `AgentGitServiceUrl` (no trailing slash).
    pub fn new(base_url: String, internal_api_key: String) -> Result<Self, AgentGitClientError> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()?;

        Ok(Self {
            http,
            base_url,
            internal_api_key,
        })
    }

    fn headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        headers
    }

    async fn checked(
        response: reqwest::Response,
    ) -> Result<reqwest::Response, AgentGitClientError> {
        let status = response.status();

        if status.is_success() {
            return Ok(response);
        }
        if status == StatusCode::CONFLICT {
            return Err(AgentGitClientError::TeamMismatch);
        }

        Err(AgentGitClientError::Status {
            status,
            body: response.text().await?,
        })
    }

    /// Create the agent's repo, or re-key it (same team). The token in the
    /// response is the only copy; earlier tokens stop working.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_repo(
        &self,
        agent_user_id: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<CreatedRepoResponse, AgentGitClientError> {
        let response = self
            .http
            .post(format!("{}/internal/repos", self.base_url))
            .headers(self.headers())
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .json(&CreateRepoRequest {
                agent_user_id,
                team_id,
            })
            .send()
            .await?;

        Ok(Self::checked(response).await?.json().await?)
    }

    /// Delete the agent's repo. Idempotent.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_repo(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), AgentGitClientError> {
        let response = self
            .http
            .delete(format!(
                "{}/internal/repos/{}",
                self.base_url,
                urlencoding::encode(agent_user_id.as_ref())
            ))
            .headers(self.headers())
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .send()
            .await?;

        Self::checked(response).await?;
        Ok(())
    }
}
