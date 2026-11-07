//! Associate a PR created through GitHub tooling with the calling session.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::SessionToolContext;

/// Set the calling session's pull request link.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "set_pull_request",
    description = "Set the pull request associated with this coding session. This records the link shown in Macro; it does not create or modify the GitHub PR. Returns the recorded URL and this session's Macro link, which belongs in the pull request description."
)]
pub struct SetPullRequest {
    /// Link to the PR this session works on.
    #[schemars(
        description = "GitHub pull request URL, e.g. https://github.com/owner/repo/pull/123"
    )]
    pub url: String,
}

/// The recorded pull request and the session that opened it.
#[derive(Debug, Serialize, JsonSchema)]
pub struct SetPullRequestOutput {
    /// The pull request URL as recorded.
    pub pull_request_url: String,
    /// The calling session in the Macro app, to link from the pull request description.
    pub session_url: String,
}

impl ToolAnnotated for SetPullRequest {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Set pull request").with_idempotent();
}

#[async_trait]
impl AsyncTool<SessionToolContext> for SetPullRequest {
    type Output = SetPullRequestOutput;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<SessionToolContext>,
        request: RequestContext,
    ) -> ToolResult<SetPullRequestOutput> {
        let pull_request_url = context
            .service
            .set_pull_request(context.session, &request.user_id, &self.url, None)
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error.into(),
            })?;
        Ok(SetPullRequestOutput {
            pull_request_url,
            session_url: context.session_url.clone(),
        })
    }
}
