//! Composition root for the production turn engine: the shared rig agent loop
//! over the Macro product toolset.
//!
//! Consumption mirrors the scheduled-action executor
//! (`crates/scheduled_action/src/outbound/inprocess_executor/agent_task.rs`):
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

use agent::{AgentError, AgentLoop, StreamPart, SystemPrompt};
use ai_tools::user_tool_review::{ReviewError, UserToolAuthorizer, authorized_user_tool_finisher};
use ai_tools::{AiHost, DeferredToolSet, ToolServiceContext, tools_for};
use ai_toolset::{AsyncToolCollection, ToolSet as AiToolSet};
use axum::extract::FromRef;
use futures::{FutureExt as _, StreamExt as _};
use macro_user_id::user_id::MacroUserIdStr;
use memory::domain::MemoryService as _;
use memory::domain::service::MemoryServiceImpl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use model_owner::Owner;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tracing::Instrument as _;

use crate::domain::auto_model::{AutoModelSelector, DefaultAutoModel, JevAutoModel};
use crate::domain::engine::{AgentIdentity, TurnEngine, TurnRequest};
use crate::domain::tool_gate::{NativeToolGate, NativeToolVerdict, UngatedNativeTools};
use crate::domain::tool_mode::{StandardTools, ToolMode, ToolModeSelector};
use crate::inbound::ask_user::{AskUser, AskUserContext};

#[path = "outbound/rig_engine/opener.rs"]
mod opener;
#[cfg(test)]
#[path = "outbound/rig_engine/test.rs"]
mod test;

#[cfg(test)]
#[path = "outbound/rig_engine/measure_prompt_cache.rs"]
mod measure_prompt_cache;

/// How many stream parts may sit unread before the engine pauses; keeps a
/// slow consumer from buffering a whole turn.
const PART_BUFFER: usize = 256;

const EAGER_INTERNAL_MCP_TOOLS: &[&str] = &[
    "mcp__macro_internal__PresentReview",
    "mcp__macro_internal__GetReview",
    "mcp__macro_internal__DecideReview",
    "mcp__macro_internal__ExecuteCode",
    "mcp__macro_internal__DescribeCodeTools",
];

const CODE_MODE_MCP_TOOLS: &[&str] = &[
    "mcp__macro_internal__ExecuteCode",
    "mcp__macro_internal__DescribeCodeTools",
];

/// [`TurnEngine`] backed by [`agent::AgentLoop`] and
/// [`ai_tools::tools_for`].
pub struct RigTurnEngine {
    memory: Arc<MemoryServiceImpl<PgMemoryRepo>>,
    native_tools: Arc<NativeTools>,
    code_mode_tools: Arc<NativeTools>,
    tool_mode: Arc<dyn ToolModeSelector>,
    auto_model: Arc<dyn AutoModelSelector>,
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
            memory: Arc::new(MemoryServiceImpl::new(
                PgMemoryRepo::new(db),
                tool_context.clone(),
                tools_for(AiHost::Chat),
            )),
            native_tools: Arc::new(NativeTools::new()),
            code_mode_tools: Arc::new(NativeTools::from_factory(
                ai_tools::tools_for_agent_code_mode,
                true,
            )),
            tool_mode: Arc::new(StandardTools),
            auto_model: match &tool_context.cognition_tool_context.service {
                Some(cognition) => Arc::new(JevAutoModel::new(Arc::clone(cognition))),
                None => Arc::new(DefaultAutoModel),
            },
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

    /// Select the owner's tool presentation once per conversational turn.
    #[must_use]
    pub fn with_tool_mode(mut self, selector: Arc<dyn ToolModeSelector>) -> Self {
        self.tool_mode = selector;
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
    reviewed_tools: Vec<String>,
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
            let mut request_context = request_context;
            let native = !UNGATED_NATIVE_TOOLS.contains(&tool_name)
                && !tool_name.starts_with(mcp_select::MANGLED_PREFIX)
                && agent_egress::domain::approval::spends_owner_access("macro", tool_name);
            let arguments = if native {
                let _waiting = self.awaiting.begin();
                let verdict = if self.reviewed_tools.iter().any(|name| name == tool_name) {
                    NativeToolVerdict::Run
                } else {
                    self.gate.check(self.session, tool_name, json).await
                };
                match verdict {
                    NativeToolVerdict::RunAs(user) => request_context.user_id = user,
                    NativeToolVerdict::Run => {}
                    NativeToolVerdict::Refuse(reason) => {
                        return Ok(Err(ai_toolset::ToolCallError {
                            internal_error: anyhow::anyhow!("{tool_name} was not approved"),
                            description: reason,
                        }));
                    }
                }
                match ai_toolset::actor::ToolActor::take(json) {
                    Ok((_, arguments)) => arguments,
                    Err(error) => {
                        return Ok(Err(ai_toolset::ToolCallError {
                            description: error.to_string(),
                            internal_error: error.into(),
                        }));
                    }
                }
            } else {
                json.clone()
            };
            self.tools
                .dispatch_tool_call(context, request_context, tool_name, &arguments)
                .await
        })
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        self.tools.request_schemas().map(|mut tools| {
            for tool in &mut tools {
                add_native_actor_schema(&tool.name, &mut tool.schema);
            }
            tools
        })
    }

    fn searchable_catalog(&self) -> Vec<ai_toolset::SearchableTool> {
        let mut tools = self.tools.searchable_catalog();
        for tool in &mut tools {
            add_native_actor_schema(&tool.name, &mut tool.schema);
        }
        tools
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.tools.searchable_toolset_names()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ai_toolset::ToolInfo> {
        self.tools.routing_description(tool_name)
    }
}

fn add_native_actor_schema(name: &str, schema: &mut schemars::Schema) {
    if !UNGATED_NATIVE_TOOLS.contains(&name)
        && !name.starts_with(mcp_select::MANGLED_PREFIX)
        && agent_egress::domain::approval::spends_owner_access("macro", name)
        && let Some(schema) = schema.as_object_mut()
    {
        ai_toolset::actor::add_actor_schema(schema);
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

/// Native definitions contain schemas and deserializers, not a user's context.
/// Build both client-capability variants once, before the first prompt. Each
/// turn still supplies its own identity, reviewer, gate, MCP tools and memory.
struct NativeTools {
    with_user_input: Arc<AsyncToolCollection<InMemToolContext>>,
    without_user_input: Arc<AsyncToolCollection<InMemToolContext>>,
    prompt: String,
    code_mode: bool,
    deferred: Arc<[ai_toolset::SearchableTool]>,
    /// Every native tool's name, for the opening line's model to guess the
    /// direction a reply will take.
    tool_names: String,
}

impl NativeTools {
    fn new() -> Self {
        Self::from_factory(|| tools_for(AiHost::AgentSession), false)
    }

    fn from_factory(build: impl Fn() -> ai_tools::ToolSetWithPrompt, code_mode: bool) -> Self {
        let tools = build();
        let base_tools = Arc::into_inner(tools.toolset)
            .expect("tools_for should return a fresh, uniquely owned collection");
        let other_tools = Arc::into_inner(build().toolset)
            .expect("tools_for should return a fresh, uniquely owned collection");
        let with_user_input = tools_for_turn(base_tools, true);
        let tool_names = with_user_input
            .tools
            .keys()
            .map(String::as_str)
            .chain(tools.deferred.iter().map(|tool| tool.name.as_str()))
            .collect::<Vec<_>>()
            .join(", ");
        Self {
            with_user_input: Arc::new(with_user_input),
            without_user_input: Arc::new(tools_for_turn(other_tools, false)),
            code_mode,
            prompt: tools.prompt.to_string(),
            deferred: tools.deferred,
            tool_names,
        }
    }

    fn for_turn(&self, supports_user_input: bool) -> Arc<AsyncToolCollection<InMemToolContext>> {
        Arc::clone(if supports_user_input {
            &self.with_user_input
        } else {
            &self.without_user_input
        })
    }
}

impl TurnEngine for RigTurnEngine {
    fn supported_models(&self) -> &[&str] {
        crate::domain::models::advertised_models()
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(PART_BUFFER);
        let memory = Arc::clone(&self.memory);
        let native_tools = Arc::clone(&self.native_tools);
        let code_mode_tools = Arc::clone(&self.code_mode_tools);
        let tool_mode = Arc::clone(&self.tool_mode);
        let auto_model = Arc::clone(&self.auto_model);
        let tool_context = self.tool_context.clone();
        let gate = Arc::clone(&self.gate);
        let metering = agent::MeteringContext::current();
        tokio::spawn(
            agent::MeteringContext::carry(metering, async move {
                let mut request = request;
                let Some(model) = select_auto_model(auto_model.as_ref(), &request).await else {
                    return;
                };
                request.model = model;
                let Some(selected) = select_tool_mode(tool_mode.as_ref(), &request).await else {
                    return;
                };
                let native_tools = match selected {
                    ToolMode::Standard => native_tools,
                    ToolMode::Code => code_mode_tools,
                };
                tracing::debug!(?selected, "selected agent tool presentation");
                // The product toolset makes this future large. Keep its state
                // on the heap when adding the panic boundary, including in
                // unoptimized local builds with Tokio's default worker stack.
                let turn = Box::pin(drive_turn(
                    &memory,
                    &native_tools,
                    tool_context,
                    gate,
                    request,
                    &parts,
                ));
                forward_turn_result(turn, &parts).await;
            })
            .in_current_span(),
        );
        receiver
    }
}

// Closing the stream alone means success to the ACP consumer. A panic in
// provider initialization must therefore become an explicit failed turn.
async fn forward_turn_result(
    turn: impl Future<Output = Result<(), AgentError>>,
    parts: &mpsc::Sender<Result<StreamPart, AgentError>>,
) {
    let result = std::panic::AssertUnwindSafe(turn)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| {
            Err(AgentError::Other(anyhow::anyhow!(
                "The agent runtime ended unexpectedly. Please retry this message."
            )))
        });
    if let Err(error) = result {
        let _ = parts.send(Err(error)).await;
    }
}

// Auto is a picker entry, not a routable id: the turn's prompt decides the
// model it runs on. Every other id passes through.
async fn select_auto_model(
    selector: &dyn AutoModelSelector,
    request: &TurnRequest,
) -> Option<String> {
    if request.model != crate::domain::models::AUTO_MODEL {
        return Some(request.model.clone());
    }
    let Owner::User(owner) = &request.owner else {
        return Some(crate::domain::models::resolve(&request.model).to_owned());
    };
    let prompt = request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == agent::types::Role::User)
        .and_then(|message| message.content.user_message_text())
        .unwrap_or_default();
    tokio::select! {
        biased;
        _ = request.cancel.cancelled() => None,
        model = selector.select(owner, &prompt) => Some(model.to_owned()),
    }
}

// A failed/missing code-mode MCP connection must never leave a turn with only the
// small direct set. Summaries neither evaluate flags nor advertise tools.
async fn select_tool_mode(
    selector: &dyn ToolModeSelector,
    request: &TurnRequest,
) -> Option<ToolMode> {
    if request.purpose != crate::domain::engine::TurnPurpose::Conversation {
        return Some(ToolMode::Standard);
    }
    let (Owner::User(owner), Some(mcp)) = (&request.owner, &request.mcp_tools) else {
        return Some(ToolMode::Standard);
    };
    let catalog = mcp.searchable_catalog();
    if !CODE_MODE_MCP_TOOLS
        .iter()
        .all(|name| catalog.iter().any(|tool| tool.name == *name))
    {
        return Some(ToolMode::Standard);
    }
    tokio::select! {
        biased;
        _ = request.cancel.cancelled() => None,
        mode = selector.select(owner) => Some(mode),
    }
}

async fn drive_turn(
    memory: &MemoryServiceImpl<PgMemoryRepo>,
    native_tools: &NativeTools,
    base_context: ToolServiceContext,
    gate: Arc<dyn NativeToolGate>,
    request: TurnRequest,
    parts: &mpsc::Sender<Result<StreamPart, AgentError>>,
) -> Result<(), AgentError> {
    let TurnRequest {
        purpose,
        session_id,
        awaiting,
        owner,
        model,
        reasoning_effort,
        speed,
        identity,
        instructions,
        messages,
        mcp_tools,
        cancel,
        user_input,
        reviewer,
    } = request;
    let started = tokio::time::Instant::now();

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

    // A summary turn condenses the conversation for its continuation: it
    // reads no memory, offers the model no tools, and is read, not shown, so
    // no opening line races it.
    let summarizing = purpose == crate::domain::engine::TurnPurpose::Summary;

    // Started before anything else so its line is out before the turn's
    // model has a first token.
    let usage_ctx = ai_usage::UsageContext::new(ai_usage::AiFeature::AgentSession, owner.clone());
    let agent = identity.as_ref().map_or_else(
        || "Macro".to_owned(),
        |identity| format!("{} (@{})", identity.name, identity.handle),
    );
    // How the race went, on one span per turn. `outcome` is `complete` (the
    // line was the whole reply), `opening` (the line opened the turn's
    // reply), `silent` (no line fit this follow-up), `turn_first` (the
    // turn's model spoke first), `no_verdict` (the
    // fast model failed or answered without one) or `timeout`.
    let opener_span = if summarizing {
        tracing::Span::none()
    } else {
        tracing::info_span!(
            "agent.opener",
            agent.opener.model = opener::MODEL,
            agent.opener.outcome = tracing::field::Empty,
            agent.opener.verdict_ms = tracing::field::Empty,
            agent.opener.line_chars = tracing::field::Empty,
            agent.opener.turn_first_part_ms = tracing::field::Empty,
        )
    };
    // A closed receiver has no verdict, and the turn's own stream follows.
    let mut opening_line = if summarizing {
        mpsc::channel(1).1
    } else {
        opener_span.in_scope(|| {
            opener::spawn(
                base_context.recorder.clone(),
                usage_ctx.clone(),
                &opener::Speaker {
                    agent: &agent,
                    model: crate::domain::models::display_name(&model),
                },
                &native_tools.tool_names,
                &messages,
            )
        })
    };
    // Chat's tools with the session's prompt: the user tools (`SendEmail`,
    // `CreateCalendarEvent`) defer to the user, and this runtime finishes
    // them in the turn through `reviewer`.
    let (system_prompt, toolset, deferred) = if summarizing {
        (
            SystemPrompt::from(instructions.unwrap_or_default()),
            Arc::new(AsyncToolCollection::<InMemToolContext>::new()),
            Arc::from(Vec::new()),
        )
    } else {
        let requested = messages
            .iter()
            .rev()
            .find(|message| message.role == agent::types::Role::User)
            .and_then(|message| message.content.user_message_text())
            .unwrap_or_default();
        let docs = async {
            if native_tools.code_mode {
                agent_code_mode::domain::select_documentation(
                    &owner,
                    &requested,
                    base_context.cognition_tool_context.service.as_ref(),
                    &cancel,
                )
                .await
            } else {
                String::new()
            }
        };
        let (user_memory, sdk_docs) = tokio::join!(fetch_user_memory(memory, &owner), docs);
        let tools_prompt = format!("{}{}", native_tools.prompt, sdk_docs);
        let prompt = system_prompt(
            &tools_prompt,
            session_id,
            identity.as_ref(),
            instructions.as_deref(),
            user_memory.as_deref(),
        );
        (
            prompt,
            native_tools.for_turn(user_input.is_some()),
            Arc::clone(&native_tools.deferred),
        )
    };
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
        .with_speed(speed)?
        .with_genai_telemetry(false);
    let mut reviewed_tools = Vec::new();
    if let Some(reviewer) = reviewer.filter(|_| !summarizing) {
        reviewed_tools = toolset.user_tools.keys().cloned().collect();
        let tools = Arc::clone(&toolset);
        let context = tool_context.clone();
        let gate = Arc::clone(&gate);
        let cancel = cancel.clone();
        let awaiting = Arc::clone(&awaiting);
        agent_loop = agent_loop.with_user_tool_finisher(Arc::new(move |mut call: agent::PendingUserTool| {
            let tools = Arc::clone(&tools);
            let context = context.clone();
            let gate = Arc::clone(&gate);
            let cancel = cancel.clone();
            let reviewer = Arc::clone(&reviewer);
            let awaiting = Arc::clone(&awaiting);
            Box::pin(async move {
                if !tools.user_tools.contains_key(&call.tool_name) { return None; }
                let (actor, arguments) = match ai_toolset::actor::ToolActor::take(&call.args) {
                    Ok(selection) => selection,
                    Err(error) => return Some(agent::FinishedUserTool::Error(error.to_string())),
                };
                let authorize_cancel = cancel.clone();
                let authorize: UserToolAuthorizer = Arc::new(move |name, mut args| {
                    let gate = Arc::clone(&gate);
                    let cancel = authorize_cancel.clone();
                    let awaiting = Arc::clone(&awaiting);
                    Box::pin(async move {
                        args[ai_toolset::actor::ACTING_AS] = serde_json::to_value(actor).map_err(|error| ReviewError::Failed(error.to_string()))?;
                        let _waiting = awaiting.begin();
                        let verdict = tokio::select! {
                            biased;
                            _ = cancel.cancelled() => return Err(ReviewError::Failed("The turn was cancelled; nothing was done.".into())),
                            verdict = gate.check(session_id, &name, &args) => verdict,
                        };
                        match verdict {
                            NativeToolVerdict::RunAs(user) => Ok(user),
                            NativeToolVerdict::Refuse(reason) => Err(ReviewError::Failed(reason)),
                            NativeToolVerdict::Run => Err(ReviewError::Failed("Could not resolve the tool actor.".into())),
                        }
                    })
                });
                call.args = arguments;
                authorized_user_tool_finisher(tools, context, reviewer, cancel, authorize)(call).await
            })
        }));
    }
    // Native tools use the actor gate unless the installed finisher authorizes
    // their final reviewed arguments. Remote MCP tools use the egress gate.
    // Keep remote MCP tools alongside the native and AskUser tools. The
    // finisher above reviews only Macro's native user tools.
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = match mcp_tools.filter(|_| !summarizing) {
        Some(mcp) => Arc::new(
            mcp_select::CombinedToolSet::new(toolset, mcp)
                .with_eager_mcp_tools(EAGER_INTERNAL_MCP_TOOLS),
        ),
        None => toolset,
    };
    // Most of Macro's tools go out by name only; the model loads the rest.
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> =
        Arc::new(DeferredToolSet::new(toolset, deferred));
    let toolset: Arc<dyn AiToolSet<_> + Send + Sync> = Arc::new(GatedToolSet {
        tools: toolset,
        gate,
        session: session_id,
        awaiting,
        reviewed_tools,
    });
    let session = agent_loop
        .session(toolset, Arc::new(tool_context), system_prompt, usage_ctx)
        .await;
    let (mut session, loop_cancel) = session.cancellable();

    // Bridge the caller's token onto the loop's own; aborted with the turn so
    // an uncancelled token does not strand the forwarder.
    let forward = tokio_util::task::AbortOnDropHandle::new(tokio::spawn({
        let loop_cancel = loop_cancel.clone();
        let cancel = cancel.clone();
        async move {
            cancel.cancelled().await;
            loop_cancel.cancel();
        }
    }));

    let rig_messages = agent::to_rig_messages(&messages);
    let result = async {
        let mut stream = session.send_message(rig_messages).await?;
        let mut turn_spoke = false;
        // The opening line's model usually has its verdict long before this
        // one's first prose. Thinking passes through while the race goes on;
        // should this model write prose or call a tool first, its own opening
        // stands and the line is dropped.
        let race = {
            let verdict =
                tokio::time::timeout(opener::VERDICT_TIMEOUT, opener::verdict(&mut opening_line));
            tokio::pin!(verdict);
            loop {
                tokio::select! {
                    biased;
                    part = stream.next() => {
                        if !turn_spoke {
                            turn_spoke = true;
                            opener_span
                                .record("agent.opener.turn_first_part_ms", elapsed_ms(started));
                        }
                        match part {
                            Some(Ok(part @ (StreamPart::Thinking(_) | StreamPart::Usage(_)))) => {
                                if parts.send(Ok(part)).await.is_err() {
                                    loop_cancel.cancel();
                                    return Ok(());
                                }
                            }
                            part => break Race::TurnFirst(part),
                        }
                    }
                    opening = &mut verdict => break Race::Opening(opening),
                }
            }
        };
        let mut separate = false;
        match race {
            Race::TurnFirst(None) => {
                opener_span.record("agent.opener.outcome", "turn_first");
                return Ok(());
            }
            Race::TurnFirst(Some(part)) => {
                opener_span.record("agent.opener.outcome", "turn_first");
                if parts.send(part).await.is_err() {
                    loop_cancel.cancel();
                    return Ok(());
                }
            }
            Race::Opening(Ok(Some(verdict))) => {
                opener_span.record("agent.opener.verdict_ms", elapsed_ms(started));
                let (outcome, line) = match verdict {
                    opener::Verdict::Complete(head) => ("complete", Some((true, head))),
                    opener::Verdict::Opening(head) => ("opening", Some((false, head))),
                    opener::Verdict::Silent => ("silent", None),
                };
                opener_span.record("agent.opener.outcome", outcome);
                if let Some((complete, head)) = line {
                    let deadline = tokio::time::Instant::now() + opener::LINE_TIMEOUT;
                    let mut line_chars = 0;
                    let mut finished = false;
                    let mut delta = Some(head);
                    while let Some(text) = delta {
                        line_chars += text.chars().count();
                        opener_span.record("agent.opener.line_chars", line_chars);
                        if !text.is_empty()
                            && parts.send(Ok(StreamPart::Content(text))).await.is_err()
                        {
                            loop_cancel.cancel();
                            return Ok(());
                        }
                        delta = match tokio::time::timeout_at(deadline, opening_line.recv()).await {
                            Ok(next) => {
                                finished = next.is_none();
                                next
                            }
                            Err(_) => None,
                        };
                    }
                    // Only a whole line stands alone: one that stalled or
                    // came out empty leaves the reply to this model.
                    if complete && finished && line_chars > 0 {
                        loop_cancel.cancel();
                        return Ok(());
                    }
                    separate = line_chars > 0;
                }
            }
            Race::Opening(Ok(None)) => {
                opener_span.record("agent.opener.outcome", "no_verdict");
            }
            Race::Opening(Err(_)) => {
                opener_span.record("agent.opener.outcome", "timeout");
            }
        }
        drop(opening_line);
        while let Some(part) = stream.next().await {
            if !turn_spoke {
                turn_spoke = true;
                opener_span.record("agent.opener.turn_first_part_ms", elapsed_ms(started));
            }
            let part = match part {
                Ok(StreamPart::Content(text)) if separate && !text.trim().is_empty() => {
                    separate = false;
                    Ok(StreamPart::Content(format!("\n\n{}", text.trim_start())))
                }
                other => other,
            };
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

/// Which spoke first: the turn's own model, or the opening line's.
enum Race {
    TurnFirst(Option<Result<StreamPart, AgentError>>),
    /// The verdict, `None` without one, or `Err` past the verdict timeout.
    Opening(Result<Option<opener::Verdict>, tokio::time::error::Elapsed>),
}

fn elapsed_ms(since: tokio::time::Instant) -> u64 {
    u64::try_from(since.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// The turn's system prompt: the agent's identity, the agent-session
/// preamble, the note that an opening line is already out (see [`opener`]),
/// the static Macro prompt (how to use the product: mentions,
/// tools, terminology), then the session's own instructions when there are
/// any, which session this is, and the owner's memory when there is any.
///
/// Identity comes first so a named agent (even one with no instructions)
/// knows who it is before reading anything else. The static Macro prompt
/// sits immediately before `<session_instructions>` so it is the preamble
/// the model reads as it takes in the caller's word — the same reason DCS
/// puts `additional_instructions` after the standing prompt. Memory stays
/// last so a remembered fact is never read as an instruction.
///
/// The prompt is split after the static Macro prompt: everything before is
/// the same for every session of the agent and is cached on its own, so a
/// session whose instructions name its own task still reads it back.
fn system_prompt(
    tools_prompt: &impl std::fmt::Display,
    session_id: agent_session::domain::model::AgentSessionId,
    identity: Option<&AgentIdentity>,
    instructions: Option<&str>,
    user_memory: Option<&str>,
) -> SystemPrompt {
    let mut shared = String::new();
    if let Some(identity) = identity {
        shared.push_str(&prompt::agent_identity::render(
            &identity.name,
            &identity.handle,
        ));
        shared.push('\n');
    }
    shared.push_str(&prompt::agent_session::PROMPT.to_string());
    shared.push('\n');
    shared.push_str(opener::ALREADY_OPENED);
    shared.push('\n');
    shared.push_str(&tools_prompt.to_string());
    let mut rest = String::new();
    // Blank instructions are "none" stated clumsily. A delimited section with
    // nothing in it is worse than no section: the model has to decide what an
    // empty instruction means.
    if let Some(instructions) = instructions.filter(|text| !text.trim().is_empty()) {
        rest.push_str("\n<session_instructions>\n");
        rest.push_str(instructions);
        rest.push_str("\n</session_instructions>");
    }
    rest.push_str(&format!(
        "\n<agent_session>\nThis conversation is agent session {session_id}. Once it grows \
         long, its earlier part is summarized to keep it within your context. To find the exact \
         words of anything said earlier, summarized or not, run ContentSearch with \
         agentSessionIds [\"{session_id}\"]. ContentSearch remains a direct tool for scoped session-history search.\n</agent_session>"
    ));
    if let Some(memory) = user_memory {
        rest.push_str("\n<user_memory>\n");
        rest.push_str(memory);
        rest.push_str("\n</user_memory>");
    }
    SystemPrompt::split(shared, rest)
}

/// The owner's memory block, or `None` when it is missing or failed to load.
async fn fetch_user_memory(
    memory_service: &MemoryServiceImpl<PgMemoryRepo>,
    owner: &MacroUserIdStr<'static>,
) -> Option<String> {
    match memory_service.get_or_generate_memory(owner.clone()).await {
        Ok(memory) => memory.map(|memory| memory.to_string()),
        Err(error) => {
            tracing::warn!(error=?error, %owner, "failed to fetch user memory; running without it");
            None
        }
    }
}
