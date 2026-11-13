//! ReadAgentMemory and UpdateAgentMemory: an agent's own memory, reached from
//! one of its sessions.

use super::bot_tool_error;
use crate::domain::{
    models::{AgentMemory, BotId, UpdateAgentMemoryRequest},
    ports::{BotError, BotService},
};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

/// An agent's own memory. Object-safe so a host can hand the tools whatever
/// bot service it runs.
#[async_trait]
pub trait OwnAgentMemory: Send + Sync + 'static {
    /// What `bot` remembers.
    async fn read(&self, bot: BotId) -> Result<AgentMemory, BotError>;
    /// Replace what `bot` remembers.
    async fn write(
        &self,
        bot: BotId,
        req: UpdateAgentMemoryRequest,
    ) -> Result<AgentMemory, BotError>;
}

#[async_trait]
impl<Svc: BotService> OwnAgentMemory for Svc {
    async fn read(&self, bot: BotId) -> Result<AgentMemory, BotError> {
        self.own_memory(bot).await
    }

    async fn write(
        &self,
        bot: BotId,
        req: UpdateAgentMemoryRequest,
    ) -> Result<AgentMemory, BotError> {
        self.update_own_memory(bot, req).await
    }
}

/// The calling session's agent and where its memory lives. The bot comes
/// from the authenticated session, never from the model.
#[derive(Clone)]
pub struct AgentMemoryToolContext {
    /// Where the memory lives.
    pub memory: Arc<dyn OwnAgentMemory>,
    /// The agent whose session is calling.
    pub bot: BotId,
}

/// The agent-memory tools, for a host that authenticates the calling session.
pub fn agent_memory_toolset() -> AsyncToolCollection<AgentMemoryToolContext> {
    AsyncToolCollection::new()
        .add_tool::<ReadAgentMemory, AgentMemoryToolContext>()
        .add_tool::<UpdateAgentMemory, AgentMemoryToolContext>()
}

/// Read what this agent remembers.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[schemars(
    title = "ReadAgentMemory",
    description = "Read your memory as this agent: the markdown every one of your sessions starts with, whoever opens it, and its revision. Read it before UpdateAgentMemory."
)]
pub struct ReadAgentMemory {}

impl ToolAnnotated for ReadAgentMemory {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read agent memory");
}

#[async_trait]
impl AsyncTool<AgentMemoryToolContext> for ReadAgentMemory {
    type Output = AgentMemory;

    async fn call(
        &self,
        context: ServiceContext<AgentMemoryToolContext>,
        _: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .memory
            .read(context.bot)
            .await
            .map_err(|error| bot_tool_error("read agent memory", error))
    }
}

/// Replace what this agent remembers.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "UpdateAgentMemory",
    description = "Replace your memory as this agent, whole. Only when someone asks you to remember, correct, or forget something about how you should work; never on your own initiative. Keep durable facts and preferences as a short markdown list, not a record of the conversation, and nothing private to one person: everyone who works with you reads it. ReadAgentMemory first and pass its revision; a stale revision changes nothing, so read again and reconcile."
)]
pub struct UpdateAgentMemory {
    /// The revision ReadAgentMemory or the last successful update returned.
    #[schemars(
        description = "The revision ReadAgentMemory or the last successful UpdateAgentMemory returned."
    )]
    pub revision: i64,
    /// The whole new memory.
    #[schemars(
        description = "The whole new memory as markdown, at most 16000 bytes, everything worth keeping included; an empty string forgets everything."
    )]
    pub content: String,
}

impl ToolAnnotated for UpdateAgentMemory {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Update agent memory").with_idempotent();
}

#[async_trait]
impl AsyncTool<AgentMemoryToolContext> for UpdateAgentMemory {
    type Output = AgentMemory;

    async fn call(
        &self,
        context: ServiceContext<AgentMemoryToolContext>,
        _: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .memory
            .write(
                context.bot,
                UpdateAgentMemoryRequest {
                    revision: self.revision,
                    content: self.content.clone(),
                },
            )
            .await
            .map_err(|error| bot_tool_error("update agent memory", error))
    }
}
