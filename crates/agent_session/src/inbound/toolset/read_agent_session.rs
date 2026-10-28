//! Read a session using the authenticated caller's view access.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::Deserialize;

use crate::domain::{
    ports::{AgentSessionLogRepo, AgentSessionRepo},
    read::{SessionConversation, SessionReader},
};

/// Session reads and the shared access boundary.
#[derive(Clone)]
pub struct ReadAgentSessionContext<R, A> {
    /// Domain conversation reader.
    pub service: Arc<SessionReader<R>>,
    /// Existing session-sharing policy.
    pub sharing: Arc<crate::domain::sharing::SessionSharingService<R>>,
    /// Mints a view-access capability for the caller.
    pub access: Arc<A>,
}

/// Read prompts, replies, tool activity, and failures in an agent session.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ReadAgentSession",
    description = "Read an agent session by its ID from an agent-session mention or search result. Returns the latest 20 messages in chronological order, including prompts, replies, tool activity and errors. Optionally select a turn number to inspect earlier history. Each message is capped at 4000 characters; truncated flags identify omitted history or text. Requires view access to the session."
)]
pub struct ReadAgentSession {
    /// Session to read.
    #[schemars(description = "The agent session UUID from its mention or search result.")]
    pub session_id: uuid::Uuid,
    /// Optional turn filter.
    #[schemars(
        description = "Read only this turn number, as returned in messages; omit for recent history."
    )]
    pub turn: Option<u32>,
}

impl ToolAnnotated for ReadAgentSession {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read agent session");
}

#[async_trait]
impl<R, A> AsyncTool<ReadAgentSessionContext<R, A>> for ReadAgentSession
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone + 'static,
    A: EntityAccessService,
{
    type Output = SessionConversation;

    #[tracing::instrument(name = "agent_session.tool.read", skip_all, fields(session_id = %self.session_id), err)]
    async fn call(
        &self,
        context: ServiceContext<ReadAgentSessionContext<R, A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = context.access.generate_entity_access_receipt::<ViewAccessLevel>(
            &request.user_id, None, &self.session_id.to_string(), EntityType::AgentSession,
        ).await.map_err(|error| ToolCallError {
            description: "Unable to read this agent session. Check the session ID and that it is shared with you.".into(),
            internal_error: error.into(),
        })?;
        context
            .service
            .read(access, self.turn)
            .await
            .map_err(|error| ToolCallError {
                description: "Unable to load the agent session conversation.".into(),
                internal_error: error.into(),
            })
    }
}

#[cfg(test)]
mod test;
