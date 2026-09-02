//! The production turn engine: the shared rig agent loop over the Macro
//! product toolset.
//!
//! Consumption mirrors the scheduled-action executor
//! (`services/scheduled_action/src/outbound/inprocess_executor/agent_task.rs`):
//! the full static toolset, the tool-use system prompt plus the agent-session
//! preamble and the owner's memory, and usage recorded per turn against the
//! session owner.
//!
//! This is also where a session's own instructions become a system prompt.
//! Nothing has to be transported for it - the loop runs in this process - which
//! is why the in-memory runtime is the one provider that needs no wire format
//! for them. See [`system_prompt`] for how the sections are ordered.

use std::sync::Arc;

use agent::{AgentError, AgentLoop, StreamPart};
use ai_tools::{ToolServiceContext, ToolSetWithPrompt, all_tools};
use ai_toolset::ToolSet as AiToolSet;
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryService as _;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::domain::engine::{TurnEngine, TurnRequest};

#[cfg(test)]
mod test;

/// How many stream parts may sit unread before the engine pauses; keeps a
/// slow consumer from buffering a whole turn.
const PART_BUFFER: usize = 256;

/// [`TurnEngine`] backed by [`agent::AgentLoop`] and
/// [`ai_tools::all_tools`].
pub struct RigTurnEngine {
    db: PgPool,
    tool_context: ToolServiceContext,
}

impl RigTurnEngine {
    /// An engine whose tools run against `tool_context` and whose user
    /// memory comes from `db`.
    #[must_use]
    pub fn new(db: PgPool, tool_context: ToolServiceContext) -> Self {
        Self { db, tool_context }
    }
}

impl TurnEngine for RigTurnEngine {
    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(PART_BUFFER);
        let db = self.db.clone();
        let tool_context = self.tool_context.clone();
        tokio::spawn(async move {
            if let Err(error) = drive_turn(db, tool_context, request, &parts).await {
                let _ = parts.send(Err(error)).await;
            }
        });
        receiver
    }
}

async fn drive_turn(
    db: PgPool,
    base_context: ToolServiceContext,
    request: TurnRequest,
    parts: &mpsc::Sender<Result<StreamPart, AgentError>>,
) -> Result<(), AgentError> {
    let TurnRequest {
        owner,
        model,
        instructions,
        messages,
        cancel,
    } = request;

    let tools = all_tools();
    let user_memory = fetch_user_memory(&db, &base_context, &owner).await;
    let system_prompt = system_prompt(
        &tools.prompt,
        instructions.as_deref(),
        user_memory.as_deref(),
    );

    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = tools.toolset;
    let agent_loop = AgentLoop::new(base_context.recorder.clone()).with_model(&model);
    let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::AgentSession, owner);
    // Carry the feature on the context so tool-spawned subagents attribute to it.
    let mut tool_context = base_context;
    tool_context.usage_context = usage_ctx.clone();
    let session = agent_loop
        .session(toolset, Arc::new(tool_context), &system_prompt, usage_ctx)
        .await;
    let (mut session, loop_cancel) = session.cancellable();

    // Bridge the caller's token onto the loop's own; aborted with the turn so
    // an uncancelled token does not strand the forwarder.
    let forward = tokio::spawn({
        let loop_cancel = loop_cancel.clone();
        let cancel = cancel.clone();
        async move {
            cancel.cancelled().await;
            loop_cancel.cancel();
        }
    });

    let rig_messages = agent::to_rig_messages(&messages);
    let result = async {
        let mut stream = session.send_message(rig_messages).await?;
        while let Some(part) = stream.next().await {
            if parts.send(part).await.is_err() {
                // The consumer is gone; stop the loop rather than keep
                // spending tokens into the void.
                loop_cancel.cancel();
                break;
            }
        }
        Ok(())
    }
    .await;
    forward.abort();
    result
}

/// The turn's system prompt: the toolset's, the agent-session preamble, then
/// the session's own instructions and the owner's memory when there are any.
///
/// Instructions land after the preamble and before the memory block for the
/// same reason DCS puts `additional_instructions` there - they are the
/// caller's word on how this session works, so they qualify the standing
/// prompt rather than being qualified by it, and memory stays last so a
/// remembered fact is never read as an instruction.
fn system_prompt(
    tools_prompt: &impl std::fmt::Display,
    instructions: Option<&str>,
    user_memory: Option<&str>,
) -> String {
    let mut prompt = format!("{}\n{}", tools_prompt, prompt::agent_session::PROMPT);
    // Blank instructions are "none" stated clumsily. A delimited section with
    // nothing in it is worse than no section: the model has to decide what an
    // empty instruction means.
    if let Some(instructions) = instructions.filter(|text| !text.trim().is_empty()) {
        prompt.push_str("\n<session_instructions>\n");
        prompt.push_str(instructions);
        prompt.push_str("\n</session_instructions>");
    }
    if let Some(memory) = user_memory {
        prompt.push_str("\n<user_memory>\n");
        prompt.push_str(memory);
        prompt.push_str("\n</user_memory>");
    }
    prompt
}

/// The owner's memory block, or `None` when it is missing or failed to load.
async fn fetch_user_memory(
    db: &PgPool,
    tool_context: &ToolServiceContext,
    owner: &MacroUserIdStr<'static>,
) -> Option<String> {
    let tools = all_tools();
    let tools = ToolSetWithPrompt {
        toolset: tools.toolset,
        prompt: tools.prompt,
    };
    let memory_service =
        MemoryServiceImpl::new(PgMemoryRepo::new(db.clone()), tool_context.clone(), tools);
    match memory_service.get_or_generate_memory(owner.clone()).await {
        Ok(memory) => memory.map(|memory| memory.to_string()),
        Err(error) => {
            tracing::warn!(error=?error, %owner, "failed to fetch user memory; running without it");
            None
        }
    }
}
