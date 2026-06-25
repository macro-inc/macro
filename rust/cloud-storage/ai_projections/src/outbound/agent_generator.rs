//! In-process agent-loop adapter that materializes ai projection results using
//! the shared AI toolset.
//!
//! Mirrors `channel_bots::outbound::AgentLoopResponder`: it runs the projection
//! prompt through the same agent loop and toolset used by channel bots and the
//! document storage service, attributing usage to [`AiFeature::AiProjection`].

use std::sync::Arc;

use agent::{AgentLoop, StreamPart, to_rig_messages};
use ai_tools::{AiToolSet, ToolServiceContext, ToolSetWithPrompt};
use ai_usage::{AiFeature, UsageContext};
use futures::StreamExt;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use crate::domain::{model::AiProjectionError, projection_generator::ProjectionGenerator};

/// [`ProjectionGenerator`] backed by the in-process agent loop and AI toolset.
#[derive(Clone)]
pub struct AgentProjectionGenerator {
    agent_loop: Arc<AgentLoop>,
    tool_context: Arc<ToolServiceContext>,
    toolset: Arc<AiToolSet>,
    system_prompt: Arc<str>,
}

impl AgentProjectionGenerator {
    /// Creates a generator from a pre-configured tool context and toolset, e.g.
    /// [`ai_tools::build_tool_service_context_from_env`] and
    /// [`ai_tools::all_tools`].
    pub fn new(tool_context: ToolServiceContext, tools: ToolSetWithPrompt) -> Self {
        Self {
            agent_loop: Arc::new(AgentLoop::new(tool_context.recorder.clone())),
            tool_context: Arc::new(tool_context),
            toolset: tools.toolset,
            system_prompt: tools.prompt.to_string().into(),
        }
    }
}

impl ProjectionGenerator for AgentProjectionGenerator {
    #[tracing::instrument(skip(self, prompt), fields(user_id = %user_id.as_ref()), err)]
    async fn generate(
        &self,
        user_id: &MacroUserIdStr<'_>,
        prompt: &str,
    ) -> Result<String, AiProjectionError> {
        let usage_ctx = UsageContext::new(AiFeature::AiProjection, user_id.clone().into_owned());

        // Carry the feature on the context so tool-spawned subagents attribute
        // to it as well.
        let mut tool_context = (*self.tool_context).clone();
        tool_context.usage_context = usage_ctx.clone();

        let toolset: Arc<dyn ai_toolset::ToolSet<ToolServiceContext> + Send + Sync> =
            self.toolset.clone();

        let mut session = self
            .agent_loop
            .session(
                toolset,
                Arc::new(tool_context),
                &self.system_prompt,
                usage_ctx,
            )
            .await;

        let messages = vec![agent::types::ChatMessage {
            role: agent::types::Role::User,
            content: agent::types::ChatMessageContent::Text(prompt.to_string()),
            attachments: None,
        }];

        let mut stream = session
            .send_message(to_rig_messages(&messages))
            .await
            .map_err(|e| AiProjectionError::Generation(e.to_string()))?;

        let mut text = String::new();
        while let Some(part) = stream.next().await {
            let part = part.map_err(|e| AiProjectionError::Generation(e.to_string()))?;
            if let StreamPart::Content(chunk) = part {
                text.push_str(&chunk);
            }
        }

        Ok(text.trim().to_string())
    }
}
