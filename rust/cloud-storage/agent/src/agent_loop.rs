/// The main entry point: [`AgentLoop`] and [`Session`].
use crate::error::AgentError;
use crate::hook::{RegisterFn, ToolRouter};
use crate::model::PredefinedModel;
use crate::model::router::{ModelRouter, ProviderAgent};
use crate::stream::ChatCompletionStream;
use crate::tool_adapter::DynToolSetAdapter;
use ai_toolset::{RequestContext, SearchableTool, ToolLoader, ToolSet as AiToolSet};
use ai_usage::{UsageContext, UsageRecorder};
use rig_core::message::Message;
use rig_core::tool::server::{ToolServer, ToolServerHandle};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;

const DEFAULT_MAX_TURNS: usize = 16;
const DEFAULT_MAX_TOKENS: u64 = 16_000;

/// Factory for creating per-request agent sessions.
///
/// Routes each session to the provider serving the selected model id (see
/// [`ModelRouter`]). The model is a
/// plain api-id string so the frontend can select it directly; backend
/// callers may pass a [`PredefinedModel`] via `with_model` (it is `ToString`).
/// Tools and system prompt are provided per-session since they vary by request
/// (MCP tools are per-user, system prompt depends on toolset selection).
pub struct AgentLoop {
    model: String,
    max_turns: usize,
    max_tokens: u64,
    recorder: Arc<dyn UsageRecorder>,
}

impl AgentLoop {
    /// Create an `AgentLoop` with provider clients from `APP_SECRETS_JSON` or the environment and
    /// the default model (Opus 4.7).
    ///
    /// `recorder` is the [`UsageRecorder`] every session created from this loop
    /// logs token usage to — it is required so that no AI call goes unrecorded.
    ///
    /// `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are required.
    pub fn new(recorder: Arc<dyn UsageRecorder>) -> Self {
        Self {
            model: PredefinedModel::default().to_string(),
            max_turns: DEFAULT_MAX_TURNS,
            max_tokens: DEFAULT_MAX_TOKENS,
            recorder,
        }
    }

    /// Override the model.
    ///
    /// Accepts any stringifiable id — an [`AgentModel`] (backend) or a raw
    /// api-id string (frontend).
    pub fn with_model<M: ToString>(mut self, model: M) -> Self {
        self.model = model.to_string();
        self
    }

    /// Override the default max tool-calling turns.
    pub fn with_max_turns(mut self, n: usize) -> Self {
        self.max_turns = n;
        self
    }

    /// Override the default max output tokens.
    pub fn with_max_tokens(mut self, n: u64) -> Self {
        self.max_tokens = n;
        self
    }

    /// Start a new streaming session.
    ///
    /// `toolset` is the combined tool set (static + MCP) for this request.
    /// `context` is the shared service context passed to tool calls.
    /// `system_prompt` is the system prompt for this request.
    /// `usage_ctx` identifies the calling user (used for tool dispatch) and the
    /// feature/entity that token usage is recorded against.
    pub async fn session<Context>(
        &self,
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        system_prompt: &str,
        usage_ctx: UsageContext,
    ) -> Session
    where
        Context: Clone + Send + Sync + 'static,
    {
        // The frontend selects the model by api id; route it to the provider
        // that serves it (falling back to the default on unknown / unavailable
        // ids). The router owns provider-specific agent construction.
        self.session_with(
            toolset,
            context,
            system_prompt,
            usage_ctx,
            |handle, prompt, max_turns, max_tokens| {
                ModelRouter::shared()
                    .expect("failed to initialize model router")
                    .agent(&self.model, handle, prompt, max_turns, max_tokens)
            },
        )
        .await
    }

    /// Like [`Self::session`], but the agent is built by `build` from the live
    /// tool-server handle and the finalized system prompt. Production routes the
    /// model through [`ModelRouter`]; tests inject a fake completion model. The
    /// rest of the per-session wiring (tool adapters, tool search, cancellation
    /// token) is identical either way.
    async fn session_with<Context>(
        &self,
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        system_prompt: &str,
        usage_ctx: UsageContext,
        build: impl FnOnce(ToolServerHandle, &str, usize, u64) -> ProviderAgent,
    ) -> Session
    where
        Context: Clone + Send + Sync + 'static,
    {
        // On-demand tool search: the toolset's searchable catalog (e.g. MCP
        // tools) is NOT sent on every request. `SearchTools` reads this catalog
        // from the request context, matches the model's query, and pushes the
        // matches into `loaded_buffer` via the loader; the stream bridge then
        // registers them with the live tool server before the next turn.
        let catalog = toolset.searchable_catalog();
        // Names of the connected toolsets (MCP servers) whose tools are
        // searchable but not advertised upfront. Injected into the system prompt
        // so the model knows which integrations it can reach via tool search.
        let searchable_toolset_names = toolset.searchable_toolset_names();
        let loaded_buffer: Arc<Mutex<Vec<SearchableTool>>> = Arc::new(Mutex::new(Vec::new()));
        let loader = {
            let buffer = loaded_buffer.clone();
            ToolLoader::new(move |tools| {
                buffer.lock().expect("loaded_buffer poisoned").extend(tools)
            })
        };
        let request_context =
            RequestContext::new(usage_ctx.user.clone()).with_tool_search(Arc::new(catalog), loader);
        // TODO this is cringe, make request context a RW lock newtype
        let request_context_rw = Arc::new(RwLock::new(request_context.clone()));

        // Keep a handle to the toolset so the stream bridge can resolve MCP
        // routing info (service / display name) for tool calls. This is the
        // authoritative source rig itself doesn't expose to the hook.
        let routing_toolset = toolset.clone();
        let routing: ToolRouter =
            Arc::new(move |name: &str| routing_toolset.routing_description(name));

        let adapters = DynToolSetAdapter::from_toolset(
            toolset.clone(),
            context.clone(),
            request_context_rw.clone(),
        );

        let handle = ToolServer::new().run();
        for adapter in adapters {
            handle
                .add_tool(adapter)
                .await
                .expect("failed to register tool");
        }

        // Registers `SearchTools`-discovered tools with the live tool server so
        // they become advertised + callable next turn. Context-erased so the
        // bridge (which is not generic over `Context`) can hold it. Captures
        // strong refs to the session's shared state but is itself only held by
        // the bridge/session — nothing the handle owns points back to it, so no
        // reference cycle.
        // Names already loaded this session, so repeated searches don't register
        // a tool twice (which would send a duplicate tool definition and 400).
        let loaded_names: Arc<Mutex<std::collections::HashSet<String>>> =
            Arc::new(Mutex::new(std::collections::HashSet::new()));
        let register_loaded: RegisterFn = {
            let handle = handle.clone();
            let toolset = toolset.clone();
            let context = context.clone();
            Arc::new(move |tools: Vec<SearchableTool>| {
                let handle = handle.clone();
                let toolset = toolset.clone();
                let context = context.clone();
                let loaded_names = loaded_names.clone();
                let request_context_rw = request_context_rw.clone();
                Box::pin(async move {
                    for tool in tools {
                        // Skip tools already loaded this session.
                        if !loaded_names
                            .lock()
                            .expect("loaded_names poisoned")
                            .insert(tool.name.clone())
                        {
                            continue;
                        }
                        let adapter = DynToolSetAdapter::loaded(
                            tool.name,
                            tool.schema,
                            toolset.clone(),
                            context.clone(),
                            request_context_rw.clone(),
                        );
                        if let Err(e) = handle.add_tool(adapter).await {
                            tracing::warn!(error = ?e, "failed to load searched tool");
                        }
                    }
                }) as Pin<Box<dyn Future<Output = ()> + Send>>
            })
        };

        // Tell the model which model it is. Done here (not on the frontend)
        // so the system prompt always reflects the model actually serving the
        // request.
        let mut system_prompt = format!("{system_prompt}\n\nYou are the {} model.", self.model);
        // Tell the model which connected integrations it can reach via tool
        // search. The prompt text lives in the `prompt` crate; the toolset names
        // are the dynamic data injected here. Omitted when nothing is connected.
        if let Some(section) = prompt::connected_toolsets::render(&searchable_toolset_names) {
            system_prompt.push_str("\n\n");
            system_prompt.push_str(&section);
        }

        let agent = build(handle, &system_prompt, self.max_turns, self.max_tokens);

        Session {
            agent,
            history: Vec::new(),
            max_turns: self.max_turns,
            routing,
            loaded_buffer,
            register_loaded,
            recorder: self.recorder.clone(),
            usage_ctx,
            model: self.model.clone(),
            request_context,
        }
    }

    /// Start a session backed by a caller-supplied (fake) completion model
    /// instead of routing through [`ModelRouter`]. Exercises the real
    /// per-session wiring and the public [`Session`] surface
    /// ([`Session::cancellable`], [`Session::send_message`]) without a provider.
    #[cfg(test)]
    pub(crate) async fn test_session<Context, M>(
        &self,
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        system_prompt: &str,
        usage_ctx: UsageContext,
        model: M,
    ) -> Session
    where
        Context: Clone + Send + Sync + 'static,
        M: rig_core::completion::CompletionModel + 'static,
        M::StreamingResponse: rig_core::completion::GetTokenUsage + Send + Sync,
    {
        self.session_with(
            toolset,
            context,
            system_prompt,
            usage_ctx,
            move |handle, prompt, max_turns, max_tokens| {
                ProviderAgent::test(model, prompt, max_turns, max_tokens, handle)
            },
        )
        .await
    }
}

/// A single streaming conversation session.
pub struct Session {
    agent: ProviderAgent,
    history: Vec<Message>,
    max_turns: usize,
    routing: ToolRouter,
    /// Tools `SearchTools` asked to load, shared with the stream bridge.
    loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
    /// Registers loaded tools with the live tool server (see [`RegisterFn`]).
    register_loaded: RegisterFn,
    recorder: Arc<dyn UsageRecorder>,
    usage_ctx: UsageContext,
    model: String,
    request_context: RequestContext,
}

impl Session {
    /// get the cancel token for this session
    pub fn cancellable(self) -> (Self, CancellationToken) {
        let cancel_token = self.request_context.cancel.clone();
        (self, cancel_token)
    }
    /// Send a message and stream the response.
    ///
    /// The returned stream yields [`StreamPart`] items compatible with the
    /// existing DCS consumer code.
    #[tracing::instrument(name = "invoke_agent", skip_all)]
    pub async fn send_message(
        &mut self,
        messages: Vec<Message>,
    ) -> Result<ChatCompletionStream<'_>, AgentError> {
        self.history = messages;

        let Some((prompt, history)) = self.history.split_last() else {
            return Err(AgentError::Other(anyhow::anyhow!(
                "messages must not be empty"
            )));
        };

        let stream = self
            .agent
            .run_stream(
                prompt.clone(),
                history.to_vec(),
                self.max_turns,
                self.routing.clone(),
                self.loaded_buffer.clone(),
                self.register_loaded.clone(),
                self.recorder.clone(),
                self.usage_ctx.clone(),
                self.model.clone(),
                self.request_context.clone(),
            )
            .await;

        Ok(stream)
    }

    /// Get the conversation messages accumulated during this session.
    pub fn get_history(&self) -> &[Message] {
        &self.history
    }
}
