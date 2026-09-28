//! Associate a PR created through GitHub tooling with the calling session.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

use super::SessionToolContext;

/// Set the calling session's pull request link.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "set_pull_request",
    description = "Set the pull request associated with this coding session. This records the link shown in Macro; it does not create or modify the GitHub PR. Returns the recorded URL."
)]
pub struct SetPullRequest {
    /// Link to the PR this session works on.
    #[schemars(
        description = "GitHub pull request URL, e.g. https://github.com/owner/repo/pull/123"
    )]
    pub url: String,
}

impl ToolAnnotated for SetPullRequest {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Set pull request").with_idempotent();
}

#[async_trait]
impl AsyncTool<SessionToolContext> for SetPullRequest {
    type Output = String;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<SessionToolContext>,
        request: RequestContext,
    ) -> ToolResult<String> {
        context
            .service
            .set_pull_request(context.session, &request.user_id, &self.url, None)
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error.into(),
            })
    }
}
