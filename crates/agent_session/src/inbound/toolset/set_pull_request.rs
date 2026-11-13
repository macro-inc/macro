//! Associate a PR created through GitHub tooling with the calling session, and
//! link the session and what started it from the PR description.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::SessionToolContext;
use crate::domain::pull_request_backlinks::{
    DescriptionLinks, LinkedDescription, PullRequestSourceKind,
};

/// Set the calling session's pull request link.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "set_pull_request",
    description = "Set the pull request associated with this coding session, and link this Macro agent session and what started it (the channel message, task, or routine) from the pull request description. Macro writes those links into the description itself as the session owner when it can (description: added or already_linked). When it cannot (description: not_written), add description_links to the description yourself. Call this after the pull request exists, and again whenever you replace its description."
)]
pub struct SetPullRequest {
    /// Link to the PR this session works on.
    #[schemars(
        description = "GitHub pull request URL, e.g. https://github.com/owner/repo/pull/123"
    )]
    pub url: String,
}

/// Whether the pull request description links the session and its source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DescriptionStatus {
    /// The description already had both links.
    AlreadyLinked,
    /// Macro added the links to the description.
    Added,
    /// Macro could not edit the description: add `description_links` to it yourself.
    NotWritten,
}

/// The recorded pull request and the links its description carries.
#[derive(Debug, Serialize, JsonSchema)]
pub struct SetPullRequestOutput {
    /// The pull request URL as recorded.
    pub pull_request_url: String,
    /// The calling session in the Macro app.
    pub session_url: String,
    /// What started the session.
    pub source_kind: PullRequestSourceKind,
    /// What started the session, in the Macro app.
    pub source_url: String,
    /// The block of links the pull request description carries, ready to paste.
    pub description_links: String,
    /// Whether the description carries them now.
    pub description: DescriptionStatus,
    /// What you still have to do, when anything.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_step: Option<String>,
}

impl SetPullRequestOutput {
    fn new(pull_request_url: String, linked: LinkedDescription) -> Self {
        let LinkedDescription {
            backlinks,
            description,
        } = linked;
        let (description, next_step) = match description {
            DescriptionLinks::AlreadyLinked => (DescriptionStatus::AlreadyLinked, None),
            DescriptionLinks::Added => (DescriptionStatus::Added, None),
            DescriptionLinks::NotWritten { reason } => (
                DescriptionStatus::NotWritten,
                Some(format!(
                    "Macro could not edit the pull request description ({reason}). Add description_links to the description yourself, for example with `gh pr edit`."
                )),
            ),
        };
        Self {
            pull_request_url,
            description_links: backlinks.block(),
            session_url: backlinks.session_url,
            source_kind: backlinks.source.kind,
            source_url: backlinks.source.url,
            description,
            next_step,
        }
    }
}

impl ToolAnnotated for SetPullRequest {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Set pull request").with_idempotent();
}

fn tool_error(error: crate::domain::error::AgentSessionError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: error.into(),
    }
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
            .map_err(tool_error)?;
        let linked = context
            .backlinks
            .link_description(context.session, &request.user_id, &pull_request_url)
            .await
            .map_err(tool_error)?;
        Ok(SetPullRequestOutput::new(pull_request_url, linked))
    }
}
