//! Composition root for the production turn engine: the shared rig agent loop
//! over the Macro product toolset.
//!
//! Consumption mirrors the scheduled-action executor
//! (`services/scheduled_action/src/outbound/inprocess_executor/agent_task.rs`):
//! the full static toolset, the agent-session preamble, the static Macro
//! prompt (immediately before any session instructions), and the owner's
//! memory, with usage recorded per turn against the session owner.
//!
//! User tools (`SendEmail`, `CreateCalendarEvent`) are the chat host's
//! deferring ones, finished inside the turn: the turn's [`TurnRequest`]
//! carries a reviewer over the ACP connection, and the agent loop's
//! user-tool finisher puts each pending call to it - the session renders the
//! elicitation - then runs or rejects the tool before the model reads the
//! result. Without a reviewer (a client with no form support) a pending call
//! stays pending, as in chat.
//!
//! This is also where a session's own instructions become a system prompt.
//! Nothing has to be transported for it - the loop runs in this process - which
//! is why the in-memory runtime is the one provider that needs no wire format
//! for them. See [`system_prompt`] for how the sections are ordered.

use std::sync::Arc;

use agent::{AgentError, AgentLoop, StreamPart};
use ai_tools::user_tool_review::user_tool_finisher;
use ai_tools::{AiHost, ToolServiceContext, ToolSetWithPrompt, tools_for};
use ai_toolset::{AsyncToolCollection, ToolSet as AiToolSet};
use axum::extract::FromRef;
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryService as _;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::domain::engine::{TurnEngine, TurnRequest};
use crate::inbound::ask_user::{AskUser, AskUserContext};

#[cfg(test)]
#[path = "outbound/rig_engine/test.rs"]
mod test;

/// How many stream parts may sit unread before the engine pauses; keeps a
/// slow consumer from buffering a whole turn.
const PART_BUFFER: usize = 256;

/// [`TurnEngine`] backed by [`agent::AgentLoop`] and
/// [`ai_tools::tools_for`].
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

#[derive(Clone)]
struct InMemToolContext {
    base: ToolServiceContext,
    ask_user: AskUserContext,
}

impl FromRef<InMemToolContext> for ToolServiceContext {
    fn from_ref(context: &InMemToolContext) -> Self {
        context.base.clone()
    }
}

impl FromRef<InMemToolContext> for AskUserContext {
    fn from_ref(context: &InMemToolContext) -> Self {
        context.ask_user.clone()
    }
}

fn tools_for_turn(
    base_tools: ai_tools::AiToolSet,
    supports_user_input: bool,
) -> AsyncToolCollection<InMemToolContext> {
    let tools = AsyncToolCollection::<InMemToolContext>::new().add_subtoolset(base_tools);
    if supports_user_input {
        tools.add_tool::<AskUser, AskUserContext>()
    } else {
        tools
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
        user_input,
        reviewer,
    } = request;

    // The chat host's toolset: its user tools (`SendEmail`,
    // `CreateCalendarEvent`) defer to the user, and this runtime finishes
    // them in the turn through `reviewer` - the session's review card is the
    // composer chat's `AiHost::Chat` doc promises.
    let tools = tools_for(AiHost::Chat);
    let user_memory = fetch_user_memory(&db, &base_context, &owner).await;
    let system_prompt = system_prompt(
        &tools.prompt,
        instructions.as_deref(),
        user_memory.as_deref(),
    );

    // `tools_for` returns a fresh Arc. Take its collection back so the
    // in-memory runtime can widen it onto the session-specific context and
    // add the one tool that needs the active ACP connection.
    let base_tools = Arc::into_inner(tools.toolset)
        .expect("tools_for should return a fresh, uniquely owned collection");
    let toolset = Arc::new(tools_for_turn(base_tools, user_input.is_some()));
    let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::AgentSession, owner.clone());
    // Carry the feature on the context so tool-spawned subagents attribute to it.
    let mut tool_context = base_context.clone();
    tool_context.usage_context = usage_ctx.clone();
    let tool_context = InMemToolContext {
        base: tool_context,
        ask_user: AskUserContext {
            requester: user_input,
        },
    };

    let mut agent_loop = AgentLoop::new(base_context.recorder.clone()).with_model(&model);
    if let Some(reviewer) = reviewer {
        agent_loop = agent_loop.with_user_tool_finisher(user_tool_finisher(
            Arc::clone(&toolset),
            tool_context.clone(),
            owner,
            reviewer,
            cancel.clone(),
        ));
    }
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = toolset;
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

/// The turn's system prompt: the agent-session preamble, the static Macro
/// prompt (how to use the product: mentions, tools, terminology), then the
/// session's own instructions and the owner's memory when there are any.
///
/// The static Macro prompt sits immediately before `<session_instructions>`
/// so it is the preamble the model reads as it takes in the caller's word —
/// the same reason DCS puts `additional_instructions` after the standing
/// prompt. Memory stays last so a remembered fact is never read as an
/// instruction.
fn system_prompt(
    tools_prompt: &impl std::fmt::Display,
    instructions: Option<&str>,
    user_memory: Option<&str>,
) -> String {
    let mut prompt = format!("{}\n{}", prompt::agent_session::PROMPT, tools_prompt);
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
    let tools = tools_for(AiHost::Chat);
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
