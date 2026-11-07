//! Session workflow actions routed to the harness domain service.
use super::CodingAgentToolContext;
use crate::domain::tool_actions::{SessionAction, SessionActionResult};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

/// Manage an existing agent conversation.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ManageAgentSession",
    description = "Rename, archive/unarchive, delete, prompt, or stop an agent session. Use ListEntities or NameSearch to find sessions and ReadAgentSession to inspect them. Rename, archive, and delete require ownership; prompting and stopping require edit access. Delete releases the runtime and permanently removes the session; use only when the user asks to delete it. Prompt returns sent/queued acceptance, not completed work. After an uncertain error, read the session before retrying; never automatically resend a prompt. This tool cannot answer permission or approval requests."
)]
pub struct ManageAgentSession {
    /// Session UUID from a mention, listing, or search result.
    pub session_id: Uuid,
    /// The session action and its parameters.
    pub action: SessionAction,
}
impl ToolAnnotated for ManageAgentSession {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Manage agent session");
}
#[async_trait]
impl AsyncTool<CodingAgentToolContext> for ManageAgentSession {
    type Output = SessionActionResult;
    #[tracing::instrument(skip_all, fields(session_id = %self.session_id), err)]
    async fn call(
        &self,
        context: ServiceContext<CodingAgentToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .sessions
            .execute(request.user_id, self.session_id, self.action.clone())
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error.into(),
            })
    }
}
