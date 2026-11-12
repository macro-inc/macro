//! In-process agent-loop adapter for channel bot responses.

use std::sync::Arc;

use agent::{AgentLoop, StreamPart, to_rig_messages};
use ai_tools::{ToolServiceContext, ToolSetWithPrompt};
use async_trait::async_trait;
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;

use super::code_mode::{ChannelBotCodeMode, ToolModes};
use crate::domain::models::BotMention;
use crate::domain::ports::AgentResponder;

/// [`AgentResponder`] backed by the in-process agent loop and AI toolset.
pub struct AgentLoopResponder {
    agent_loop: AgentLoop,
    tool_context: Arc<ToolServiceContext>,
    tools: ToolModes,
}

impl AgentLoopResponder {
    /// Create a responder from a pre-configured tool context and toolset.
    pub fn new(tool_context: ToolServiceContext, tools: ToolSetWithPrompt) -> Self {
        Self {
            agent_loop: AgentLoop::new(tool_context.recorder.clone()),
            tool_context: Arc::new(tool_context),
            tools: ToolModes::direct(tools),
        }
    }

    /// Answer in code mode for the users `code.gate` lets in.
    #[must_use]
    pub fn with_code_mode(mut self, code: ChannelBotCodeMode) -> Self {
        self.tools = self.tools.with_code_mode(code);
        self
    }
}

#[async_trait]
impl AgentResponder for AgentLoopResponder {
    #[tracing::instrument(
        skip(self, prompt, user_id),
        fields(message_id = %mention.message_id, code_mode = tracing::field::Empty),
        err
    )]
    async fn respond(
        &self,
        user_id: &str,
        mention: BotMention,
        prompt: String,
    ) -> anyhow::Result<String> {
        let user_id = MacroUserIdStr::try_from(user_id.to_string())?;
        let tools = self
            .tools
            .for_reply(
                &user_id,
                &mention,
                self.tool_context.cognition_tool_context.service.clone(),
            )
            .await;
        tracing::Span::current().record("code_mode", tools.code_mode);

        let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::ChannelBot, user_id);
        // Carry the feature on the context so AI calls made by tools are attributed to it.
        let mut tool_context = (*self.tool_context).clone();
        tool_context.usage_context = usage_ctx.clone();
        let mut session = self
            .agent_loop
            .session(
                tools.toolset,
                Arc::new(tool_context),
                &tools.system_prompt,
                usage_ctx,
            )
            .await;

        let messages = vec![agent::types::ChatMessage {
            role: agent::types::Role::User,
            content: agent::types::ChatMessageContent::Text(prompt),
            attachments: None,
        }];

        let mut stream = session.send_message(to_rig_messages(&messages)).await?;
        let mut text = String::new();
        while let Some(part) = stream.next().await {
            if let StreamPart::Content(chunk) = part? {
                text.push_str(&chunk);
            }
        }

        Ok(text.trim().to_string())
    }
}
