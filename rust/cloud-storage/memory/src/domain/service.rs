use super::ports::*;
use ai::chat_completion::get_chat_completion;
use ai::tool::tool_loop::ai_client::ToolLoop;
use ai::types::*;
use ai_tools::{ToolServiceContext, ToolSetWithPrompt};
use ai_toolset::RequestContext;
use futures::stream::StreamExt;
use serde::Deserialize;
use std::sync::Arc;

static GENERATION_MODEL: Model = Model::Claude46Opus;
static JUDGE_MODEL: Model = Model::Claude46Sonnet;

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

Don't include things that would make sense to find via tool search at runtime. \
Focus on context that is useful as permanent background knowledge.

CRITICAL: Your response must contain ONLY the memory text. \
No preamble, no postscript, no commentary, no \"Let me...\", no \"Here is...\". \
Do not narrate your research process. Do not address the user. \
Just output the raw memory text starting with the first substantive line.";

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
- It contains narration about the research process (\"I found...\", \"The workspace has...\").

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

impl<Rpo> MemoryService for MemoryServiceImpl<Rpo>
where
    Rpo: MemoryRepo,
{
    #[tracing::instrument(skip(self), err)]
    async fn generate_memory(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> super::Result<Memory> {
        let request = RequestBuilder::new()
            .model(GENERATION_MODEL)
            .system_prompt(self.tools.prompt)
            .user_message(GENERATE_MEMORY_PROMPT)
            .build();

        let mut agent = ToolLoop::new(self.tools.toolset.clone(), self.tool_context.clone()).chat();

        let request_context = RequestContext {
            user_id: user.clone(),
            jwt: Arc::new("fake_jwt".into()),
        };

        {
            let mut stream = agent
                .send_message(request, request_context, user.clone().into())
                .await?;

            while let Some(next) = stream.next().await {
                next?;
            }
        }

        let messages = agent.get_new_conversation_messages();

        let Some(memory) = messages.last().and_then(|message| {
            let text = message.content.message_text();
            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        }) else {
            return Err(MemoryError::NoMemory);
        };

        // 2nd pass: judge the memory quality
        judge_memory(&memory).await?;

        self.memory_repo.save_memory(&memory, user).await?;
        Ok(memory)
    }

    async fn get_latest_memory(
        &self,
        user: macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> super::Result<Memory> {
        self.memory_repo.get_latest_memory(user).await
    }
}

#[tracing::instrument(skip(memory), err)]
async fn judge_memory(memory: &str) -> super::Result<()> {
    let user_message = format!(
        "Evaluate this memory and respond with ONLY a JSON object \
         (no markdown, no code fences):\n\
         {{\"accepted\": true/false, \"reason\": \"one sentence explanation\"}}\n\n\
         ---\n\n{memory}"
    );

    let request = RequestBuilder::new()
        .model(JUDGE_MODEL)
        .system_prompt(JUDGE_PROMPT)
        .user_message(&user_message)
        .build();

    let response = get_chat_completion(request)
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
