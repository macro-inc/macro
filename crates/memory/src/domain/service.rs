use super::ports::*;
use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, PredefinedModel, StreamPart};
use ai_billing::domain::AiAdmissionService;
use ai_tools::{ToolServiceContext, ToolSetWithPrompt};
use ai_usage::AiFeature;
use chrono::Utc;
use futures::stream::StreamExt;
use macro_env::Environment;
use serde::Deserialize;
use std::{future::Future, sync::Arc};

static GENERATION_MODEL: PredefinedModel = PredefinedModel::Smart;
static JUDGE_MODEL: PredefinedModel = PredefinedModel::Sonnet4_6;

static GENERATE_MEMORY_PROMPT: &str = "\
Use tool calls to research who I am, what I care about, what I'm working on, \
and anything else that would be useful as permanent knowledge. Look at my \
documents, projects, emails, channels, and search for content I've created.

Then generate a ~1000-3000 word memory about me that will be prepended to \
future prompts to provide personalized answers. Focus on:
- My role, team, and responsibilities
- Technologies, tools, and languages I use
- Current projects and priorities
- Domain knowledge and expertise
- Communication style and preferences

If a previous memory is provided in the system prompt, use it as the baseline \
for the new memory. Preserve still-accurate durable facts, verify and update it \
with fresh tool research, add important new context, and remove obsolete or \
unsupported details.

Don't include things that would make sense to find via tool search at runtime. \
Focus on context that is useful as permanent background knowledge.

Only state a corporate title or founder status when content written by people \
(documents, emails, bios, announcements) states it explicitly; otherwise \
describe what the person works on and skip the title. This applies to titles \
inherited from the previous memory too — a title you can't re-confirm from \
content gets dropped, not preserved.

Output format: wrap the finished memory in <memory></memory> tags. Everything \
outside the tags is discarded, and a response without the tags is rejected \
entirely. Inside the tags, write only the memory itself — no preamble, no \
postscript, no commentary, no narration of your research process (\"I have \
enough context\", \"Let me write the memory\", \"Now I have a comprehensive \
picture\"), and no text addressed to the user.";

static JUDGE_PROMPT: &str = "\
You are a strict quality judge for AI-generated user memory profiles.

A \"memory\" is a ~1000-3000 word summary of a user prepended to future AI prompts \
for personalization. A good memory is built from rich data: documents the user wrote, \
projects they manage, emails they sent, channels they participate in, and search results \
showing their work.

REJECT if ANY of the following are true:
- The memory is based on insufficient data (e.g. only a handful of chat titles, \
  no documents, no projects, no emails). A memory built from nearly empty workspace \
  data is useless speculation.
- It is mostly guesswork or hedged inferences (\"likely\", \"suggests\", \"may\") \
  rather than concrete facts derived from actual content.
- It is under ~500 words of substantive content.
- It lacks specific details about the user's actual work, codebase, projects, or role.
- It reads like a personality quiz rather than a professional profile grounded in \
  real workspace activity.
- It contains the generator's narration or self-talk anywhere in the text \
  (\"I have enough context\", \"Let me write the memory\", \"I need to research\", \
  \"Now I have a comprehensive picture\", \"I found...\", \"The workspace has...\").

ACCEPT only if the memory contains concrete, specific, actionable context derived \
from substantial workspace data (documents, code, projects, emails, messages) that \
would meaningfully improve future AI interactions.";

#[derive(Debug, Deserialize)]
struct MemoryJudgement {
    accepted: bool,
    reason: String,
}

pub struct MemoryServiceImpl<Rpo> {
    memory_repo: Rpo,
    tool_context: ToolServiceContext,
    tools: ToolSetWithPrompt,
}

impl<Rpo> MemoryServiceImpl<Rpo> {
    pub fn new(
        memory_repo: Rpo,
        tool_context: ToolServiceContext,
        tools: ToolSetWithPrompt,
    ) -> Self {
        Self {
            memory_repo,
            tool_context,
            tools,
        }
    }
}

/// Default max age for memory freshness (1 day).
const MAX_AGE: std::time::Duration = std::time::Duration::from_hours(24);

impl<Rpo> MemoryService for MemoryServiceImpl<Rpo>
where
    Rpo: MemoryRepo + Clone,
{
    #[tracing::instrument(skip(self), err)]
    async fn get_or_generate_memory(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> super::Result<Option<Memory>> {
        read_memory_with_regeneration(
            &self.memory_repo,
            user.clone(),
            !matches!(Environment::new_or_prod(), Environment::Local),
            |previous_memory| {
                let repo = self.memory_repo.clone();
                let tool_context = self.tool_context.clone();
                let tools = ToolSetWithPrompt {
                    toolset: self.tools.toolset.clone(),
                    prompt: Box::new(self.tools.prompt.to_string()),
                };
                async move {
                    let svc = MemoryServiceImpl::new(repo, tool_context, tools);
                    svc.generate_memory(user, previous_memory).await
                }
            },
        )
        .await
    }
}

impl<Rpo> MemoryServiceImpl<Rpo>
where
    Rpo: MemoryRepo,
{
    // `previous_memory` carries the user's full personal-memory profile; it
    // must never be captured as a span field or it ends up verbatim in logs.
    #[tracing::instrument(skip(self, previous_memory), err)]
    async fn generate_memory(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'static>,
        previous_memory: Option<Memory>,
    ) -> super::Result<Memory> {
        generate_memory_with(
            &self.memory_repo,
            self.tool_context.admission.as_ref(),
            user.clone(),
            self.generate_and_judge_memory(user, previous_memory),
        )
        .await
    }

    async fn generate_and_judge_memory(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'static>,
        previous_memory: Option<Memory>,
    ) -> super::Result<Memory> {
        // append user data + datetime to prompt
        let system_prompt = build_generation_system_prompt(
            &self.tools.prompt,
            &user,
            &Utc::now().to_rfc2822(),
            previous_memory.as_deref(),
        );

        let agent_loop =
            AgentLoop::new(self.tool_context.recorder.clone()).with_model(GENERATION_MODEL);
        let toolset: Arc<dyn ai_toolset::ToolSet<_> + Send + Sync> =
            self.tools.toolset.clone() as _;
        let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user.clone());
        // Carry the feature on the context so tool-spawned subagents attribute to it.
        let mut tool_context = self.tool_context.clone();
        tool_context.usage_context = usage_ctx.clone();
        let mut session = agent_loop
            .session(toolset, Arc::new(tool_context), &system_prompt, usage_ctx)
            .await;

        let user_msg = ChatMessage {
            content: ChatMessageContent::Text(GENERATE_MEMORY_PROMPT.to_string()),
            role: Role::User,
            attachments: None,
        };
        let rig_messages = agent::to_rig_messages(&[user_msg]);

        let mut content = String::new();
        {
            let mut stream = session.send_message(rig_messages).await?;

            while let Some(next) = stream.next().await {
                let part = next?;
                if let StreamPart::Content(text) = part {
                    content.push_str(&text);
                }
            }
        }

        let Some(memory) = extract_memory_body(&content).map(str::to_string) else {
            tracing::warn!(
                content_len = content.len(),
                "generation output missing <memory> tags"
            );
            return Err(MemoryError::NoGeneration);
        };
        if memory.is_empty() {
            return Err(MemoryError::NoGeneration);
        }

        // 2nd pass: judge the memory quality
        judge_memory(&memory, user.clone(), self.tool_context.recorder.as_ref()).await?;

        Ok(memory)
    }
}

// Keep cached reads independent of background admission and generation failures.
async fn read_memory_with_regeneration<Rpo, F, Fut>(
    repo: &Rpo,
    user: macro_user_id::user_id::MacroUserIdStr<'static>,
    generation_enabled: bool,
    generate: F,
) -> super::Result<Option<Memory>>
where
    Rpo: MemoryRepo,
    F: FnOnce(Option<Memory>) -> Fut + Send,
    Fut: Future<Output = super::Result<Memory>> + Send + 'static,
{
    let record = repo.get_latest_memory(user.clone()).await?;
    let needs_generation = match &record {
        Some(record) => {
            let age = Utc::now() - record.updated_at;
            age > chrono::Duration::from_std(MAX_AGE).unwrap_or(chrono::TimeDelta::MAX)
        }
        None => true,
    };

    if needs_generation && generation_enabled {
        let generation = generate(record.as_ref().map(|record| record.memory.clone()));
        tokio::spawn(async move {
            match generation.await {
                Ok(_) => tracing::info!(%user, "memory generated"),
                Err(MemoryError::Admission(error)) => {
                    tracing::warn!(%user, error = ?error, "memory generation skipped: admission failed")
                }
                Err(MemoryError::Rejected(reason)) => {
                    tracing::warn!(%user, %reason, "memory rejected by judge")
                }
                Err(error) => tracing::error!(%user, error = ?error, "memory generation failed"),
            }
        });
    }

    Ok(record.map(|record| record.memory))
}

// One admission covers the entire generation and quality-judge future. Do not
// poll it before admission or recheck allowance between its model calls.
async fn generate_memory_with<Rpo: MemoryRepo>(
    repo: &Rpo,
    admission: &dyn AiAdmissionService,
    user: macro_user_id::user_id::MacroUserIdStr<'static>,
    generation: impl Future<Output = super::Result<Memory>> + Send,
) -> super::Result<Memory> {
    admission.admit(&user, AiFeature::Memory).await?;
    let memory = generation.await?;
    repo.save_memory(&memory, user).await?;
    Ok(memory)
}

/// Extract the memory body from the agent's final message.
///
/// The generation prompt requires the memory to be wrapped in <memory> tags so
/// that any narration the model emits around it is discarded deterministically
/// rather than trusting the model to suppress it.
fn extract_memory_body(content: &str) -> Option<&str> {
    let start = content.find("<memory>")? + "<memory>".len();
    let end = content.rfind("</memory>")?;
    content.get(start..end).map(str::trim)
}

fn build_generation_system_prompt(
    base_prompt: impl std::fmt::Display,
    user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    datetime: &str,
    previous_memory: Option<&str>,
) -> String {
    let mut prompt =
        format!("{base_prompt}\n<user_id>{user:?}</user_id>\n<datetime>{datetime}</datetime>");

    if let Some(memory) = previous_memory {
        prompt.push_str("\n<previous_memory>\n");
        prompt.push_str(memory);
        prompt.push_str("\n</previous_memory>");
    }

    prompt
}

#[tracing::instrument(skip(memory, user, recorder), err)]
async fn judge_memory(
    memory: &str,
    user: macro_user_id::user_id::MacroUserIdStr<'static>,
    recorder: &dyn ai_usage::UsageRecorder,
) -> super::Result<()> {
    let user_message = format!(
        "Evaluate this memory and respond with ONLY a JSON object \
         (no markdown, no code fences):\n\
         {{\"accepted\": true/false, \"reason\": \"one sentence explanation\"}}\n\n\
         ---\n\n{memory}"
    );

    let response = agent::complete(
        JUDGE_MODEL,
        JUDGE_PROMPT,
        &user_message,
        recorder,
        ai_usage::UsageContext::new(ai_usage::AiFeature::Memory, user),
    )
    .await
    .map_err(|e| anyhow::anyhow!(e))?;

    let judgement: MemoryJudgement = serde_json::from_str(response.trim())
        .map_err(|e| anyhow::anyhow!("failed to parse judge response: {e}\nraw: {response}"))?;

    tracing::info!(accepted = judgement.accepted, reason = %judgement.reason, "Memory judgement");

    if !judgement.accepted {
        return Err(MemoryError::Rejected(judgement.reason));
    }

    Ok(())
}

#[cfg(test)]
mod test;
