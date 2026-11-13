//! Pull request descriptions on GitHub, read and written with the session
//! owner's linked GitHub account: the same account their agents open pull
//! requests as.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_session::domain::pull_request_backlinks::{
    PullRequestDescriptionError, PullRequestDescriptions, PullRequestNumber,
};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::ports::LinkedGithubTokens;
use reqwest::StatusCode;
use tracing::Instrument;

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const USER_AGENT: &str = "macro-agent-harness";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// [`PullRequestDescriptions`] over GitHub's REST API.
pub(crate) struct GithubPullRequestDescriptions {
    client: reqwest::Client,
    tokens: Arc<dyn LinkedGithubTokens>,
    api_base_url: String,
}

/// The part of a pull request this reads and writes.
#[derive(serde::Serialize, serde::Deserialize)]
struct Description {
    body: Option<String>,
}

impl GithubPullRequestDescriptions {
    /// Call GitHub with each owner's link token from `tokens`.
    pub(crate) fn new(tokens: Arc<dyn LinkedGithubTokens>) -> anyhow::Result<Self> {
        Self::with_api_base_url(tokens, GITHUB_API_BASE_URL)
    }

    fn with_api_base_url(
        tokens: Arc<dyn LinkedGithubTokens>,
        api_base_url: &str,
    ) -> anyhow::Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            tokens,
            api_base_url: api_base_url.trim_end_matches('/').to_owned(),
        })
    }

    #[tracing::instrument(name = "github.linked_token", skip_all, err)]
    async fn token(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<String, PullRequestDescriptionError> {
        self.tokens
            .access_token(owner)
            .await
            .map_err(|error| PullRequestDescriptionError::Upstream(error.to_string()))?
            .ok_or(PullRequestDescriptionError::NotLinked)
    }

    fn request(
        &self,
        method: reqwest::Method,
        token: &str,
        pull_request: &PullRequestNumber,
    ) -> reqwest::RequestBuilder {
        let PullRequestNumber {
            owner,
            repo,
            number,
        } = pull_request;
        self.client
            .request(
                method,
                format!("{}/repos/{owner}/{repo}/pulls/{number}", self.api_base_url),
            )
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    async fn send(
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, PullRequestDescriptionError> {
        let response = request
            .send()
            .await
            .map_err(|error| PullRequestDescriptionError::Upstream(error.to_string()))?;
        let status = response.status();
        tracing::Span::current().record("http.response.status_code", status.as_u16());
        if status.is_success() {
            return Ok(response);
        }
        let message = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&message)
            .ok()
            .and_then(|body| body["message"].as_str().map(str::to_owned))
            .unwrap_or_else(|| status.to_string());
        Err(match status {
            StatusCode::UNAUTHORIZED => PullRequestDescriptionError::NotLinked,
            // A rate limit is a 403 or 429 that names it; anything else GitHub refused.
            StatusCode::FORBIDDEN | StatusCode::NOT_FOUND | StatusCode::UNPROCESSABLE_ENTITY
                if !message.to_ascii_lowercase().contains("rate limit") =>
            {
                PullRequestDescriptionError::Refused(message)
            }
            _ => PullRequestDescriptionError::Upstream(message),
        })
    }
}

impl PullRequestDescriptions for GithubPullRequestDescriptions {
    fn read<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        pull_request: &'a PullRequestNumber,
    ) -> Pin<Box<dyn Future<Output = Result<String, PullRequestDescriptionError>> + Send + 'a>>
    {
        let span = tracing::info_span!(
            "github.pull_request.read_description",
            github.repository = %format!("{}/{}", pull_request.owner, pull_request.repo),
            github.pull_request = pull_request.number,
            http.response.status_code = tracing::field::Empty,
        );
        Box::pin(
            async move {
                let token = self.token(owner).await?;
                let response =
                    Self::send(self.request(reqwest::Method::GET, &token, pull_request)).await?;
                let description: Description = response
                    .json()
                    .await
                    .map_err(|error| PullRequestDescriptionError::Upstream(error.to_string()))?;
                Ok(description.body.unwrap_or_default())
            }
            .instrument(span),
        )
    }

    fn write<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        pull_request: &'a PullRequestNumber,
        description: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), PullRequestDescriptionError>> + Send + 'a>> {
        let span = tracing::info_span!(
            "github.pull_request.write_description",
            github.repository = %format!("{}/{}", pull_request.owner, pull_request.repo),
            github.pull_request = pull_request.number,
            http.response.status_code = tracing::field::Empty,
        );
        Box::pin(
            async move {
                let token = self.token(owner).await?;
                Self::send(
                    self.request(reqwest::Method::PATCH, &token, pull_request)
                        .json(&Description {
                            body: Some(description.to_owned()),
                        }),
                )
                .await?;
                Ok(())
            }
            .instrument(span),
        )
    }
}
