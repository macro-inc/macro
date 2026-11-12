//! The generic agent adapter accepts only a host-supplied read toolset.
use crate::domain::ports::*;
use agent_loop::{
    AgentLoop, PredefinedModel, StreamPart,
    types::{ChatMessage, ChatMessageContent, Role},
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

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
        let system = agent_prompts::compose(&[
            &self.tool_prompt,
            &agent_prompts::privacy::PROMPT,
            &identity,
        ]);
        let agent = AgentLoop::new(self.recorder.clone()).with_model(PredefinedModel::Smart);
        let mut session = agent
            .session(
                self.tools.clone(),
                Arc::new(self.context.clone()),
                system,
                ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
            )
            .await;
        let request = agent_prompts::compose(&[
            &instructions,
            &"Wrap only the final report in <memory></memory> tags. Do not narrate your research inside the tags.",
        ]);
        let messages = agent_loop::to_rig_messages(&[ChatMessage {
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
        let system = agent_prompts::compose(&[&agent_prompts::privacy::PROMPT, &instructions]);
        agent_loop::complete(
            PredefinedModel::Smart,
            &system,
            sources,
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
        )
        .await
        .map_err(|e| MemoryError::Other(anyhow::anyhow!(e)))
    }

    #[tracing::instrument(skip_all, err)]
    async fn judge(&self, user: MacroUserIdStr<'static>, content: &str) -> Result<()> {
        let instructions = include_str!("generator/judge.md");
        let system = agent_prompts::compose(&[&agent_prompts::privacy::PROMPT, &instructions]);
        let response = agent_loop::complete(
            PredefinedModel::Sonnet4_6,
            &system,
            content,
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
        )
        .await
        .map_err(|e| MemoryError::Other(anyhow::anyhow!(e)))?;
        #[derive(serde::Deserialize)]
        struct Judgement {
            accepted: bool,
        }
        let judgement: Judgement = serde_json::from_str(response.trim())
            .map_err(|_| MemoryError::Rejected("judge did not return a valid decision".into()))?;
        if !judgement.accepted {
            return Err(MemoryError::Rejected(
                "content did not pass privacy and quality review".into(),
            ));
        }
        Ok(())
    }
}
