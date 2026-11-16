//! The generic agent adapter accepts only a host-supplied read toolset.
use crate::domain::ports::*;
use agent::{
    AgentLoop, PredefinedModel, ReasoningEffort, StreamPart,
    types::{ChatMessage, ChatMessageContent, Role},
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

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

    #[tracing::instrument(skip_all, err)]
    async fn judge(&self, user: MacroUserIdStr<'static>, content: &str) -> Result<()> {
        let instructions = include_str!("generator/judge.md");
        let system = prompt::compose(&[&prompt::privacy::PROMPT, &instructions]);
        let response = agent::complete(
            PredefinedModel::Sonnet4_6,
            &system,
            content,
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
        )
        .await
        .map_err(|e| MemoryError::Other(anyhow::anyhow!(e)))?;
        let accepted = judge_decision(&response)
            .ok_or_else(|| MemoryError::Rejected("judge did not return a valid decision".into()))?;
        if !accepted {
            return Err(MemoryError::Rejected(
                "content did not pass privacy and quality review".into(),
            ));
        }
        Ok(())
    }
}

/// The judge's `{"accepted": bool}` decision, wherever it sits in the reply: a
/// code fence or surrounding prose must not turn an answer into a failure.
/// Conflicting decisions are no decision, and so is any `"accepted"` key that
/// does not parse: a malformed rejection must not yield the approval it quotes.
fn judge_decision(response: &str) -> Option<bool> {
    #[derive(serde::Deserialize)]
    struct Judgement {
        accepted: bool,
    }
    let decisions: Vec<bool> = response
        .match_indices('{')
        .filter_map(|(start, _)| {
            serde_json::Deserializer::from_str(response.get(start..)?)
                .into_iter::<Judgement>()
                .next()?
                .ok()
                .map(|judgement| judgement.accepted)
        })
        .collect();
    if decisions.len() != response.matches(r#""accepted""#).count() {
        return None;
    }
    let (&first, rest) = decisions.split_first()?;
    rest.iter()
        .all(|&accepted| accepted == first)
        .then_some(first)
}
