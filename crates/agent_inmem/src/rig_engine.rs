//! Composition root for the production turn engine: the shared rig agent loop
//! over the Macro product toolset.
//!
//! Consumption mirrors the scheduled-action executor
//! (`services/scheduled_action/src/outbound/inprocess_executor/agent_task.rs`):
//! the full static toolset, the agent's name and handle, the agent-session
//! preamble, the static Macro prompt (immediately before any session
//! instructions), and the owner's memory, with usage recorded per turn
//! against the session owner.
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
use ai_tools::{AiHost, DeferredToolSet, ToolServiceContext, ToolSetWithPrompt, tools_for};
use ai_toolset::{AsyncToolCollection, ToolSet as AiToolSet};
use axum::extract::FromRef;
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryService as _;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use model_owner::Owner;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tracing::Instrument as _;

use crate::domain::engine::{AgentIdentity, TurnEngine, TurnRequest};
use crate::domain::tool_gate::{NativeToolGate, NativeToolVerdict, UngatedNativeTools};
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
    gate: Arc<dyn NativeToolGate>,
}

impl RigTurnEngine {
    /// An engine whose tools run against `tool_context` and whose user
    /// memory comes from `db`. Every native tool runs ungated until
    /// [`Self::with_gate`] says otherwise.
    #[must_use]
    pub fn new(db: PgPool, tool_context: ToolServiceContext) -> Self {
        Self {
            db,
            tool_context,
            gate: Arc::new(UngatedNativeTools),
        }
    }

    /// Ask `gate` before each of Macro's own tools runs.
    #[must_use]
    pub fn with_gate(mut self, gate: Arc<dyn NativeToolGate>) -> Self {
        self.gate = gate;
        self
    }
}

/// Native tools never gated: asking the user something, and finding or
/// loading a connected app's tools, spend nobody's access.
const UNGATED_NATIVE_TOOLS: [&str; 3] = ["AskUser", "SearchTools", "LoadTools"];

/// A turn's tools, each call to one of Macro's own asked of the gate first.
/// Remote MCP tools are left to the egress proxy, which gates them already.
struct GatedToolSet<Context> {
    tools: Arc<dyn AiToolSet<Context> + Send + Sync>,
    gate: Arc<dyn NativeToolGate>,
    session: agent_session::domain::model::AgentSessionId,
    awaiting: Arc<crate::domain::engine::AwaitingUser>,
}

impl<Context> AiToolSet<Context> for GatedToolSet<Context>
where
    Context: Send + Sync + 'static,
{
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: ai_toolset::RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ai_toolset::ToolCallFuture<'a> {
        Box::pin(async move {
            if !UNGATED_NATIVE_TOOLS.contains(&tool_name)
                && !tool_name.starts_with(mcp_select::MANGLED_PREFIX)
                && let NativeToolVerdict::Refuse(reason) = {
                    // A call held for the owner is the turn waiting on a
                    // person, not hanging: the idle timeout leaves it be.
                    let _waiting = self.awaiting.begin();
                    self.gate.check(self.session, tool_name, json).await
                }
            {
                return Ok(Err(ai_toolset::ToolCallError {
                    internal_error: anyhow::anyhow!("{tool_name} was not approved"),
                    description: reason,
                }));
            }
            self.tools
                .dispatch_tool_call(context, request_context, tool_name, json)
                .await
        })
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        self.tools.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<ai_toolset::SearchableTool> {
        self.tools.searchable_catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.tools.searchable_toolset_names()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ai_toolset::ToolInfo> {
        self.tools.routing_description(tool_name)
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
    fn supported_models(&self) -> &[&str] {
        crate::domain::models::advertised_models()
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(PART_BUFFER);
        let db = self.db.clone();
        let tool_context = self.tool_context.clone();
        let gate = Arc::clone(&self.gate);
        let metering = agent::MeteringContext::current();
        tokio::spawn(
            agent::MeteringContext::carry(metering, async move {
                if let Err(error) = drive_turn(db, tool_context, gate, request, &parts).await {
                    let _ = parts.send(Err(error)).await;
                }
            })
            .in_current_span(),
        );
        receiver
    }
}

async fn drive_turn(
    db: PgPool,
    base_context: ToolServiceContext,
    gate: Arc<dyn NativeToolGate>,
    request: TurnRequest,
    parts: &mpsc::Sender<Result<StreamPart, AgentError>>,
) -> Result<(), AgentError> {
    let TurnRequest {
        session_id,
        awaiting,
        owner,
        model,
        reasoning_effort,
        identity,
        instructions,
        messages,
        mcp_tools,
        cancel,
        user_input,
        reviewer,
    } = request;

    // A turn runs as a person: tools act with the owner's identity, the
    // memory is theirs, and usage is billed to them. A session owned by
    // anything else has no turn to run here, and says so instead of running
    // as somebody it is not.
    let owner = match owner {
        Owner::User(owner) => owner,
        other => {
            return Err(AgentError::Other(anyhow::anyhow!(
                "in-process turns run as the session owner, who must be a user; \
                 this session is owned by a {}",
                other.owner_type()
            )));
        }
    };

    // Chat's tools with the session's prompt: the user tools (`SendEmail`,
    // `CreateCalendarEvent`) defer to the user, and this runtime finishes
    // them in the turn through `reviewer`.
    let tools = tools_for(AiHost::AgentSession);
    let user_memory = fetch_user_memory(&db, &base_context, &owner).await;
    let system_prompt = system_prompt(
        &tools.prompt,
        identity.as_ref(),
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
    // The tools act as the session's bot, delegated for the owner: its writes
    // are attributed to it and presented under its name, not Macro's.
    if let Some(identity) = &identity {
        tool_context = tool_context
            .with_actor(identity.bot)
            .with_actor_name(&identity.name);
    }
    let tool_context = InMemToolContext {
        base: tool_context,
        ask_user: AskUserContext {
            requester: user_input,
        },
    };

    // GenAI telemetry stays off here: this runtime's turns and tool calls
    // reach the session actor as ACP frames, and the actor projects those onto
    // `invoke_agent` / `execute_tool` spans for every harness alike. Enriching
    // rig's spans too would report each turn twice.
    let mut agent_loop = AgentLoop::new(base_context.recorder.clone())
        .with_model(&model)
        .with_reasoning_effort(reasoning_effort)
        .with_genai_telemetry(false);
    if let Some(reviewer) = reviewer {
        agent_loop = agent_loop.with_user_tool_finisher(user_tool_finisher(
            Arc::clone(&toolset),
            tool_context.clone(),
            owner,
            reviewer,
            cancel.clone(),
        ));
    }
    // Macro's own tools spend the owner's access in-process, so they ask the
    // gate a turn somebody else prompted must pass - the one the egress
    // proxy applies to every MCP server. Remote MCP tools already pass
    // through that proxy and are not asked twice.
    // Keep remote MCP tools alongside the native and AskUser tools. The
    // finisher above reviews only Macro's native user tools.
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = match mcp_tools {
        Some(mcp) => Arc::new(mcp_select::CombinedToolSet::new(toolset, mcp)),
        None => toolset,
    };
    // Most of Macro's tools go out by name only; the model loads the rest.
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> =
        Arc::new(DeferredToolSet::new(toolset, tools.deferred));
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = Arc::new(GatedToolSet {
        tools: toolset,
        gate,
        session: session_id,
        awaiting,
    });
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

/// The turn's system prompt: the agent's identity, the agent-session
/// preamble, the static Macro prompt (how to use the product: mentions,
/// tools, terminology), then the session's own instructions and the owner's
/// memory when there are any.
///
/// Identity comes first so a named agent (even one with no instructions)
/// knows who it is before reading anything else. The static Macro prompt
/// sits immediately before `<session_instructions>` so it is the preamble
/// the model reads as it takes in the caller's word — the same reason DCS
/// puts `additional_instructions` after the standing prompt. Memory stays
/// last so a remembered fact is never read as an instruction.
fn system_prompt(
    tools_prompt: &impl std::fmt::Display,
    identity: Option<&AgentIdentity>,
    instructions: Option<&str>,
    user_memory: Option<&str>,
) -> String {
    let mut prompt = String::new();
    if let Some(identity) = identity {
        prompt.push_str(&prompt::agent_identity::render(
            &identity.name,
            &identity.handle,
        ));
        prompt.push('\n');
    }
    prompt.push_str(&prompt::agent_session::PROMPT.to_string());
    prompt.push('\n');
    prompt.push_str(&tools_prompt.to_string());
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
        deferred: tools.deferred,
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
