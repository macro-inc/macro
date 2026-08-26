//! The production turn engine: the shared rig agent loop over the Macro
//! product toolset.
//!
//! Consumption mirrors the scheduled-action executor
//! (`services/scheduled_action/src/outbound/inprocess_executor/agent_task.rs`):
//! the full static toolset, the tool-use system prompt plus the agent-session
//! preamble and the owner's memory, and usage recorded per turn against the
//! session owner.

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
        messages,
        cancel,
    } = request;

    let tools = all_tools();
    let user_memory = fetch_user_memory(&db, &base_context, &owner).await;
    let system_prompt = match user_memory {
        Some(memory) => format!(
            "{}\n{}\n<user_memory>\n{}\n</user_memory>",
            tools.prompt,
            prompt::agent_session::PROMPT,
            memory
        ),
        None => format!("{}\n{}", tools.prompt, prompt::agent_session::PROMPT),
    };

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
