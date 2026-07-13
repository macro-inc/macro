//! Model routing.
//!
//! Routing turns a `provider/model` api id into a runnable agent and owns the
//! provider fan-out so the rest of the crate stays provider-agnostic:
//!
//! - [`RoutedModel`] — the routed id bound to its provider client. One arm per
//!   wire protocol: Anthropic-native, OpenAI Responses, and OpenAI-compatible
//!   Chat Completions. Compatible providers live in a data registry keyed by
//!   name, so adding one is [`with_openai_provider`](ModelRouter::with_openai_provider).
//! - [`ProviderAgent`] — a built rig agent, with the same arms. Its
//!   [`run_stream`](ProviderAgent::run_stream) matches internally, so callers
//!   (e.g. `agent_loop`) hold one type and never fan out.
//!
//! Ids are addressed as `provider/model` (e.g. `anthropic/claude-opus-4-8`,
//! `groq/llama-3.3-70b`); routing picks the provider from the segment, never by
//! sniffing the id. Unroutable ids fall back to the default model.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use ai_toolset::{RequestContext, SearchableTool};
use ai_usage::{UsageContext, UsageRecorder};
use futures::StreamExt;
use macro_env_var::env_var;
use rig_core::agent::{Agent, AgentBuilder, MultiTurnStreamItem};
use rig_core::completion::{CompletionModel, GetTokenUsage};
use rig_core::message::Message;
use rig_core::providers::{anthropic, openai};
use rig_core::streaming::{StreamedAssistantContent, StreamingPrompt};
use rig_core::tool::server::ToolServerHandle;

use super::PredefinedModel;
use super::anthropic::AnthropicModel;
use super::openai::{OpenAiChatCompletionsModel, OpenAiResponsesModel};
use super::types::Model;
use crate::error::AgentError;
use crate::hook::{RegisterFn, StreamBridge, ToolRouter};
use crate::stream::{ChatCompletionStream, StreamPart};

env_var! {
    struct ApiKeys {
        AnthropicApiKey,
        OpenaiApiKey,
        CerebrasApiKey
    }
}

/// Provider segment for native Anthropic.
const ANTHROPIC_PROVIDER: &str = "anthropic";
/// Provider segment the built-in OpenAI client is registered under.
const OPENAI_PROVIDER: &str = "openai";
/// Provider segment Cerebras is registered under (OpenAI-compatible Chat
/// Completions).
const CEREBRAS_PROVIDER: &str = "cerebras";
/// Cerebras inference endpoint (OpenAI-compatible Chat Completions API).
const CEREBRAS_BASE_URL: &str = "https://api.cerebras.ai/v1";

/// A routed model id bound to the provider client that serves it.
pub(crate) enum RoutedModel<'a> {
    /// A model on Anthropic's native API.
    Anthropic(AnthropicModel<'a>),
    /// A model on the OpenAI-compatible Chat Completions API.
    OpenAiChatCompletions(OpenAiChatCompletionsModel<'a>),
    /// A model on OpenAI's Responses API.
    OpenAiResponses(OpenAiResponsesModel<'a>),
}

impl<'a> RoutedModel<'a> {
    /// Build the rig agent for this model, applying provider-specific thinking
    /// config. Pure construction — no model call is made here.
    pub(crate) fn into_agent(
        self,
        handle: ToolServerHandle,
        system_prompt: &str,
        max_turns: usize,
        max_tokens: u64,
    ) -> ProviderAgent {
        match self {
            RoutedModel::Anthropic(m) => {
                let thinking = m.thinking_params();
                ProviderAgent::Anthropic(build_agent(
                    m.completion(),
                    thinking,
                    handle,
                    system_prompt,
                    max_turns,
                    max_tokens,
                ))
            }
            RoutedModel::OpenAiChatCompletions(m) => {
                let thinking = m.thinking_params();
                ProviderAgent::OpenAiChatCompletions(build_agent(
                    m.completion(),
                    thinking,
                    handle,
                    system_prompt,
                    max_turns,
                    max_tokens,
                ))
            }
            RoutedModel::OpenAiResponses(m) => {
                let thinking = m.thinking_params();
                ProviderAgent::OpenAiResponses(build_agent(
                    m.completion(),
                    thinking,
                    handle,
                    system_prompt,
                    max_turns,
                    max_tokens,
                ))
            }
        }
    }
}

/// A built rig agent bound to the provider serving the session's model.
///
/// The two arms are different concrete `Agent<M>` types; [`run_stream`] hides
/// that behind one concrete [`ChatCompletionStream`], so callers never match.
///
/// [`run_stream`]: ProviderAgent::run_stream
pub(crate) enum ProviderAgent {
    /// An agent over Anthropic's native completion model.
    Anthropic(Agent<anthropic::completion::CompletionModel>),
    /// An agent over the OpenAI Chat Completions model.
    OpenAiChatCompletions(Agent<openai::completion::CompletionModel>),
    /// An agent over the OpenAI Responses model.
    OpenAiResponses(Agent<openai::responses_api::ResponsesCompletionModel>),
    /// A test-only agent over an arbitrary completion model (e.g. a scripted
    /// fake), type-erased so the enum itself stays non-generic.
    #[cfg(test)]
    Test(Box<dyn DynStreamAgent>),
}

impl ProviderAgent {
    /// Run the agentic loop and adapt rig's stream into the provider-agnostic
    /// [`StreamPart`] stream consumed by DCS. The provider fan-out is internal.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn run_stream(
        &self,
        prompt: Message,
        history: Vec<Message>,
        max_turns: usize,
        routing: ToolRouter,
        loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
        register_loaded: RegisterFn,
        recorder: Arc<dyn UsageRecorder>,
        usage_ctx: UsageContext,
        model: String,
        request_context: RequestContext,
    ) -> ChatCompletionStream<'static> {
        match self {
            ProviderAgent::Anthropic(agent) => {
                drive_stream(
                    agent,
                    prompt,
                    history,
                    max_turns,
                    routing,
                    loaded_buffer,
                    register_loaded,
                    recorder,
                    usage_ctx,
                    model,
                    request_context.clone(),
                )
                .await
            }
            ProviderAgent::OpenAiChatCompletions(agent) => {
                drive_stream(
                    agent,
                    prompt,
                    history,
                    max_turns,
                    routing,
                    loaded_buffer,
                    register_loaded,
                    recorder,
                    usage_ctx,
                    model,
                    request_context.clone(),
                )
                .await
            }
            ProviderAgent::OpenAiResponses(agent) => {
                drive_stream(
                    agent,
                    prompt,
                    history,
                    max_turns,
                    routing,
                    loaded_buffer,
                    register_loaded,
                    recorder,
                    usage_ctx,
                    model,
                    request_context.clone(),
                )
                .await
            }
            #[cfg(test)]
            ProviderAgent::Test(agent) => {
                agent
                    .run_stream_dyn(
                        prompt,
                        history,
                        max_turns,
                        routing,
                        loaded_buffer,
                        register_loaded,
                        recorder,
                        usage_ctx,
                        model,
                        request_context.clone(),
                    )
                    .await
            }
        }
    }
}

/// Routes model api-id strings to the provider client that serves them.
///
/// Holds native Anthropic and OpenAI Responses clients plus a registry of
/// OpenAI-compatible Chat Completions clients keyed by provider name. The
/// built-in [`OPENAI_PROVIDER`] always uses Responses; register compatible
/// providers with [`with_openai_provider`](Self::with_openai_provider).
#[derive(Clone)]
pub struct ModelRouter {
    anthropic: Arc<anthropic::Client>,
    openai: Arc<openai::Client>,
    openai_compatible: HashMap<String, Arc<openai::CompletionsClient>>,
}

impl ModelRouter {
    /// Build a router over native Anthropic and OpenAI Responses clients, with
    /// no OpenAI-compatible Chat Completions providers registered yet.
    pub fn new(anthropic: anthropic::Client, openai: openai::Client) -> Self {
        Self {
            anthropic: Arc::new(anthropic),
            openai: Arc::new(openai),
            openai_compatible: HashMap::new(),
        }
    }

    /// Build a router with the built-in providers from the environment.
    ///
    /// Requires `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `CEREBRAS_API_KEY`.
    /// Chain [`with_openai_provider`](Self::with_openai_provider) to add more.
    pub fn try_from_env() -> Result<Self, AgentError> {
        let env = ApiKeys::new()?;
        let anthropic = anthropic::Client::builder()
            .api_key(env.anthropic_api_key.to_string())
            .build()?;
        // Default base URL is api.openai.com; OpenAI's GPT models use
        // Responses API so reasoning models get max_output_tokens.
        let openai = openai::Client::builder()
            .api_key(env.openai_api_key.to_string())
            .build()?;
        // Cerebras speaks the OpenAI Chat Completions API, so it rides the
        // compatible-provider registry: `cerebras/<model>` ids route to it.
        Self::new(anthropic, openai).with_openai_provider(
            CEREBRAS_PROVIDER,
            CEREBRAS_BASE_URL,
            &env.cerebras_api_key,
        )
    }

    /// The process-wide full router, built from the environment on first use.
    ///
    /// This is the only router the crate uses — every entry point routes through
    /// the same fully-populated instance, so a model id resolves identically
    /// everywhere. Register additional OpenAI-compatible providers here as they
    /// are added.
    pub(crate) fn shared() -> Result<&'static ModelRouter, AgentError> {
        static ROUTER: OnceLock<ModelRouter> = OnceLock::new();
        if let Some(router) = ROUTER.get() {
            return Ok(router);
        }
        let router = Self::try_from_env()?;
        Ok(ROUTER.get_or_init(|| router))
    }

    /// Register an already-built OpenAI-compatible Chat Completions client under
    /// `provider`.
    pub fn with_openai_client(
        mut self,
        provider: impl Into<String>,
        client: openai::CompletionsClient,
    ) -> Self {
        self.openai_compatible
            .insert(provider.into(), Arc::new(client));
        self
    }

    /// Register an OpenAI-compatible Chat Completions provider from a base URL
    /// and key.
    ///
    /// This is the whole cost of adding a provider — models served by it are
    /// then reachable as `provider/<model-id>`. The extension point for the
    /// open provider set (Cerebras is wired this way in [`try_from_env`]).
    ///
    /// [`try_from_env`]: Self::try_from_env
    pub fn with_openai_provider(
        self,
        provider: impl Into<String>,
        base_url: &str,
        api_key: &str,
    ) -> Result<Self, AgentError> {
        let client = openai::CompletionsClient::builder()
            .api_key(api_key)
            .base_url(base_url)
            .build()?;
        Ok(self.with_openai_client(provider, client))
    }

    /// Route + build the agent in one step, falling back to the default model on
    /// an unroutable id.
    pub(crate) fn agent(
        &self,
        model: &str,
        handle: ToolServerHandle,
        system_prompt: &str,
        max_turns: usize,
        max_tokens: u64,
    ) -> ProviderAgent {
        self.route_or_default(model)
            .into_agent(handle, system_prompt, max_turns, max_tokens)
    }

    /// Route a `provider/model` id to the provider that serves it.
    ///
    /// Returns [`AgentError::UnknownModel`] if no provider claims it (and
    /// [`AgentError::MalformedModel`] if the id has no `provider/` segment).
    pub(crate) fn route<'a>(&self, model: &'a str) -> Result<RoutedModel<'a>, AgentError> {
        let parsed = Model::try_from(model)?;

        if parsed.provider() == ANTHROPIC_PROVIDER {
            return Ok(RoutedModel::Anthropic(AnthropicModel::new(
                parsed,
                self.anthropic.clone(),
            )));
        }
        if parsed.provider() == OPENAI_PROVIDER {
            return Ok(RoutedModel::OpenAiResponses(OpenAiResponsesModel::new(
                parsed,
                self.openai.clone(),
            )));
        }
        if let Some(client) = self.openai_compatible.get(parsed.provider()) {
            let client = Arc::clone(client);
            return Ok(RoutedModel::OpenAiChatCompletions(
                OpenAiChatCompletionsModel::new(parsed, client),
            ));
        }
        Err(AgentError::UnknownModel(model.to_string()))
    }

    /// Route `model`, falling back to the default model on an unroutable id.
    pub(crate) fn route_or_default<'a>(&self, model: &'a str) -> RoutedModel<'a> {
        self.route(model).unwrap_or_else(|_| self.default_model())
    }

    /// The fallback model: native Anthropic serving [`PredefinedModel::Smart`].
    ///
    /// Built via `From<PredefinedModel>` so the bound [`Model`] carries the
    /// bare api id — `PredefinedModel`'s `Display` is the provider-qualified
    /// routing id, which the Anthropic API rejects as a model name.
    fn default_model(&self) -> RoutedModel<'static> {
        RoutedModel::Anthropic(AnthropicModel::new(
            PredefinedModel::Smart.into(),
            self.anthropic.clone(),
        ))
    }
}

/// Build a rig agent from a completion model and per-session config.
fn build_agent<M: CompletionModel>(
    model: M,
    thinking: Option<serde_json::Value>,
    handle: ToolServerHandle,
    system_prompt: &str,
    max_turns: usize,
    max_tokens: u64,
) -> Agent<M> {
    let mut builder = AgentBuilder::new(model)
        .tool_server_handle(handle)
        .default_max_turns(max_turns)
        .max_tokens(max_tokens)
        .preamble(system_prompt);
    if let Some(params) = thinking {
        builder = builder.additional_params(params);
    }
    builder.build()
}

/// Run the agentic loop on `agent` and adapt rig's stream into the
/// provider-agnostic [`StreamPart`] stream consumed by DCS.
#[allow(clippy::too_many_arguments)]
async fn drive_stream<M>(
    agent: &Agent<M>,
    prompt: Message,
    history: Vec<Message>,
    max_turns: usize,
    routing: ToolRouter,
    loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
    register_loaded: RegisterFn,
    recorder: Arc<dyn UsageRecorder>,
    usage_ctx: UsageContext,
    model: String,
    request_context: RequestContext,
) -> ChatCompletionStream<'static>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: GetTokenUsage + Send + Sync,
{
    let (bridge, mut rx) = StreamBridge::channel(
        routing,
        loaded_buffer,
        register_loaded,
        request_context.searchable_tools.clone(),
        request_context.cancel.clone(),
    );
    // Driver-side sender for parts derived from rig stream items (thinking,
    // usage, errors). The lifecycle hooks (text, tool call, tool response) send
    // through their own clone inside `bridge`; both feed the same FIFO channel.
    let driver_tx = bridge.sender();

    let mut rig_stream = agent
        .stream_prompt(prompt)
        .with_history(history)
        .multi_turn(max_turns)
        .max_invalid_tool_call_retries(crate::hook::MAX_INVALID_TOOL_CALL_RETRIES)
        .with_hook(bridge)
        .await;

    // Drive the rig stream on its own task. The hook emits a tool call the
    // moment the model finishes it — *before* the (often slow) tool executes —
    // but rig runs that execution inside a single `rig_stream.next()` poll, so
    // draining the channel only between polls would hold the pending tool call
    // hidden until its response landed. Polling the rig stream here, off the
    // consumer's path, lets every hook-emitted part flow through `rx` and out
    // to the client as soon as it is produced — so a tool call renders in its
    // pending state immediately and its response renders when execution
    // finishes.
    let driver = tokio::spawn(async move {
        let mut thinking_buf = String::new();

        while let Some(item) = rig_stream.next().await {
            match item {
                Ok(MultiTurnStreamItem::StreamAssistantItem(
                    StreamedAssistantContent::ReasoningDelta { reasoning, .. },
                )) => {
                    thinking_buf.push_str(&reasoning);
                }
                other => {
                    if !thinking_buf.is_empty() {
                        let _ = driver_tx
                            .send(Ok(StreamPart::Thinking(std::mem::take(&mut thinking_buf))));
                    }
                    match other {
                        Ok(MultiTurnStreamItem::FinalResponse(final_resp)) => {
                            let usage = final_resp.usage();
                            // Best-effort cost logging; never fails the stream.
                            recorder.record(usage_ctx.clone().into_event(
                                model.clone(),
                                usage.input_tokens,
                                usage.output_tokens,
                            ));
                            let _ = driver_tx.send(Ok(StreamPart::Usage(crate::stream::Usage {
                                input_tokens: usage.input_tokens,
                                output_tokens: usage.output_tokens,
                            })));
                        }
                        Err(e) => {
                            let _ = driver_tx.send(Err(AgentError::Streaming(e)));
                        }
                        _ => {}
                    }
                }
            }
        }
        if !thinking_buf.is_empty() {
            let _ = driver_tx.send(Ok(StreamPart::Thinking(std::mem::take(&mut thinking_buf))));
        }
        // Dropping `rig_stream` (and with it the hook's sender) plus `driver_tx`
        // here closes the channel, ending the consumer stream below.
    });

    // Abort the driver when the consumer drops the returned stream (e.g. on
    // cancellation), which drops `rig_stream` and cancels any in-flight tool —
    // matching the prior behaviour where the rig stream lived inline.
    struct AbortOnDrop(tokio::task::JoinHandle<()>);
    impl Drop for AbortOnDrop {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let guard = AbortOnDrop(driver);

    let stream = async_stream::stream! {
        let _guard = guard;
        while let Some(part) = rx.recv().await {
            yield part;
        }
    };

    Box::pin(stream)
}

/// Test-only type erasure so [`ProviderAgent`] can hold an arbitrary
/// [`Agent<M>`] (e.g. a scripted fake model) without the enum becoming generic.
/// Mirrors the production arms: it just drives [`drive_stream`].
#[cfg(test)]
pub(crate) trait DynStreamAgent: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    fn run_stream_dyn<'a>(
        &'a self,
        prompt: Message,
        history: Vec<Message>,
        max_turns: usize,
        routing: ToolRouter,
        loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
        register_loaded: RegisterFn,
        recorder: Arc<dyn UsageRecorder>,
        usage_ctx: UsageContext,
        model: String,
        request_context: RequestContext,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = ChatCompletionStream<'static>> + Send + 'a>,
    >;
}

#[cfg(test)]
impl<M> DynStreamAgent for Agent<M>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: GetTokenUsage + Send + Sync,
{
    fn run_stream_dyn<'a>(
        &'a self,
        prompt: Message,
        history: Vec<Message>,
        max_turns: usize,
        routing: ToolRouter,
        loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
        register_loaded: RegisterFn,
        recorder: Arc<dyn UsageRecorder>,
        usage_ctx: UsageContext,
        model: String,
        request_context: RequestContext,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = ChatCompletionStream<'static>> + Send + 'a>,
    > {
        Box::pin(drive_stream(
            self,
            prompt,
            history,
            max_turns,
            routing,
            loaded_buffer,
            register_loaded,
            recorder,
            usage_ctx,
            model,
            request_context,
        ))
    }
}

#[cfg(test)]
impl ProviderAgent {
    /// Build a test-only [`ProviderAgent`] backed by `model` (a fake completion
    /// model), wired through the same [`build_agent`] used in production.
    pub(crate) fn test<M>(
        model: M,
        system_prompt: &str,
        max_turns: usize,
        max_tokens: u64,
        handle: ToolServerHandle,
    ) -> Self
    where
        M: CompletionModel + 'static,
        M::StreamingResponse: GetTokenUsage + Send + Sync,
    {
        ProviderAgent::Test(Box::new(build_agent(
            model,
            None,
            handle,
            system_prompt,
            max_turns,
            max_tokens,
        )))
    }
}
