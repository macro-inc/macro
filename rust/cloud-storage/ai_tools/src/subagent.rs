use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolLoop, ToolResult};
use ai::types::{Model, RequestBuilder};
use async_trait::async_trait;
use futures::stream::StreamExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{ToolServiceContext, subagent_toolset};

static SUBAGENT_MODEL: Model = Model::Claude46Sonnet;

static SUBAGENT_PROMPT: &str = include_str!("prompts/subagent.md");

#[derive(Debug, Serialize, JsonSchema)]
pub struct SubagentResponse {
    pub result: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "Subagent",
    description = "Delegate a task to a subagent that can independently use tools to research and complete it. The subagent has access to search, documents, properties, and call tools. Use this for tasks that require multiple tool calls or independent research."
)]
pub struct Subagent {
    #[schemars(
        description = "A detailed description of the task for the subagent to complete. Be specific about what information to find or what action to take."
    )]
    pub task: String,
}

#[async_trait]
impl AsyncTool<ToolServiceContext> for Subagent {
    type Output = SubagentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ToolServiceContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let toolset = Arc::new(subagent_toolset());

        let request = RequestBuilder::new()
            .model(SUBAGENT_MODEL)
            .system_prompt(SUBAGENT_PROMPT)
            .user_message(&self.task)
            .build();

        let mut chat = ToolLoop::new(toolset, service_context.0.clone()).chat();

        {
            let mut stream = chat
                .send_message(
                    request,
                    request_context.clone(),
                    request_context.user_id.to_string(),
                )
                .await
                .map_err(|e| ToolCallError {
                    description: "failed to start subagent".to_string(),
                    internal_error: e.into(),
                })?;

            while let Some(next) = stream.next().await {
                next.map_err(|e| ToolCallError {
                    description: "subagent encountered an error".to_string(),
                    internal_error: e.into(),
                })?;
            }
        }

        let messages = chat.get_new_conversation_messages();
        let text = messages
            .last()
            .map(|m| m.content.message_text())
            .unwrap_or_default();

        Ok(SubagentResponse { result: text })
    }
}
