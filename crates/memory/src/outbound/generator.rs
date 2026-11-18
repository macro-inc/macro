//! The generic agent adapter accepts only a host-supplied read toolset.
use crate::domain::ports::*;
use agent::{
    AgentLoop, PredefinedModel, ReasoningEffort, StreamPart,
    types::{ChatMessage, ChatMessageContent, Role},
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

/// Research and summaries run on Sonnet 5.5: Opus 4.8 cost about 2.7x as much
/// for the same tokens.
const GENERATION_MODEL: PredefinedModel = PredefinedModel::Sonnet5_5;
/// Sonnet 5.5 defaults to high effort; medium is the starting point for
/// multistep tool use.
const GENERATION_EFFORT: ReasoningEffort = ReasoningEffort::Medium;

/// A model adapter whose tool context is supplied at the composition root.
pub struct AgentMemoryGenerator<C> {
    pub context: C,
    pub tools: Arc<dyn ai_toolset::ToolSet<C> + Send + Sync>,
    pub tool_prompt: String,
    pub recorder: Arc<dyn ai_usage::UsageRecorder>,
}

#[async_trait::async_trait]
impl<C: Clone + Send + Sync + 'static> MemoryGenerator for AgentMemoryGenerator<C> {
    #[tracing::instrument(skip_all, err)]
    async fn research(&self, user: MacroUserIdStr<'static>, instructions: &str) -> Result<String> {
        let identity = format!(
            "Research subject: {user}. Current UTC time: {}.",
            chrono::Utc::now()
        );
        let system = prompt::compose(&[&self.tool_prompt, &prompt::privacy::PROMPT, &identity]);
        let agent = AgentLoop::new(self.recorder.clone())
            .with_model(GENERATION_MODEL)
            .with_reasoning_effort(GENERATION_EFFORT);
        let mut session = agent
            .session(
                self.tools.clone(),
                Arc::new(self.context.clone()),
                system,
                ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
            )
            .await;
        let request = prompt::compose(&[
            &instructions,
            &"Wrap only the final report in <memory></memory> tags. Do not narrate your research inside the tags.",
        ]);
        let messages = agent::to_rig_messages(&[ChatMessage {
            content: ChatMessageContent::Text(request),
            role: Role::User,
            attachments: None,
        }]);
        let mut output = String::new();
        let mut stream = session.send_message(messages).await?;
        while let Some(part) = stream.next().await {
            if let StreamPart::Content(text) = part? {
                output.push_str(&text);
            }
        }
        let start = output
            .rfind("<memory>")
            .map(|i| i + "<memory>".len())
            .ok_or(MemoryError::NoGeneration)?;
        let end = output.rfind("</memory>").ok_or(MemoryError::NoGeneration)?;
        let report = output
            .get(start..end)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or(MemoryError::NoGeneration)?;
        Ok(report.to_owned())
    }

    #[tracing::instrument(skip_all, err)]
    async fn summarize(
        &self,
        user: MacroUserIdStr<'static>,
        instructions: &str,
        sources: &str,
    ) -> Result<String> {
        let system = prompt::compose(&[&prompt::privacy::PROMPT, &instructions]);
        let messages = agent::to_rig_messages(&[ChatMessage {
            content: ChatMessageContent::Text(sources.to_owned()),
            role: Role::User,
            attachments: None,
        }]);
        // Sonnet 5.5 rejects disabled thinking, so a one-shot sets effort like the research loop.
        let params = serde_json::json!({
            "thinking": { "type": "adaptive" },
            "output_config": { "effort": GENERATION_EFFORT.as_str() },
        });
        agent::complete_with_history_and_params(
            GENERATION_MODEL,
            &system,
            messages,
            Some(params),
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
        )
        .await
        .map_err(|e| MemoryError::Other(anyhow::anyhow!(e)))
    }
}
