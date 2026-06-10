/// The main entry point: [`AgentLoop`] and [`Session`].
use crate::error::AgentError;
use crate::hook::{StreamBridge, ToolRouter};
use crate::model::{AgentModel, ModelProvider};
use crate::stream::{ChatCompletionStream, StreamPart};
use crate::tool_adapter::DynToolSetAdapter;
use ai_toolset::{RequestContext, ToolSet as AiToolSet};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use rig_core::agent::{Agent, MultiTurnStreamItem};
use rig_core::client::{CompletionClient, ProviderClient};
use rig_core::completion::{CompletionModel, GetTokenUsage};
use rig_core::message::Message;
use rig_core::providers::{anthropic, openai};
use rig_core::streaming::{StreamedAssistantContent, StreamingPrompt};
use rig_core::tool::server::{ToolServer, ToolServerHandle};
use std::sync::{Arc, RwLock};

const DEFAULT_MAX_TURNS: usize = 16;
const DEFAULT_MAX_TOKENS: u64 = 16_000;

/// Factory for creating per-request agent sessions.
///
/// Holds one client per provider and routes each session to the provider
/// serving the selected model (see [`AgentModel::provider`]). Tools and
/// system prompt are provided per-session since they vary by request
/// (MCP tools are per-user, system prompt depends on toolset selection).
pub struct AgentLoop {
    anthropic: anthropic::Client,
    openai: Option<openai::Client>,
    model: AgentModel,
    max_turns: usize,
    max_tokens: u64,
}

impl Default for AgentLoop {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentLoop {
    /// Create an `AgentLoop` with provider clients from the environment and
    /// the default model (Opus 4.7).
    ///
    /// `ANTHROPIC_API_KEY` is required. `OPENAI_API_KEY` is optional at
    /// construction; selecting an OpenAI model without it panics at
    /// session creation.
    pub fn new() -> Self {
        let anthropic = anthropic::Client::from_env().expect("ANTHROPIC_API_KEY must be set");
        let openai = openai::Client::from_env().ok();
        Self {
            anthropic,
            openai,
            model: AgentModel::default(),
            max_turns: DEFAULT_MAX_TURNS,
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }

    /// Override the model.
    pub fn with_model(mut self, model: AgentModel) -> Self {
        self.model = model;
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

    fn build_agent<M: CompletionModel>(
        &self,
        model: M,
        handle: ToolServerHandle,
        system_prompt: &str,
    ) -> Agent<M> {
        rig_core::agent::AgentBuilder::new(model)
            .tool_server_handle(handle)
            .default_max_turns(self.max_turns)
            .max_tokens(self.max_tokens)
            .additional_params(self.model.thinking_params())
            .preamble(system_prompt)
            .build()
    }

    /// Start a new streaming session.
    ///
    /// `toolset` is the combined tool set (static + MCP) for this request.
    /// `context` is the shared service context passed to tool calls.
    /// `system_prompt` is the system prompt for this request.
    /// `user_id` identifies the calling user for tool dispatch.
    pub async fn session<Context>(
        &self,
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        system_prompt: &str,
        user_id: MacroUserIdStr<'static>,
    ) -> Session
    where
        Context: Clone + Send + Sync + 'static,
    {
        let request_context = Arc::new(RwLock::new(RequestContext { user_id }));

        // Keep a handle to the toolset so the stream bridge can resolve MCP
        // routing info (service / display name) for tool calls. This is the
        // authoritative source rig itself doesn't expose to the hook.
        let routing_toolset = toolset.clone();
        let routing: ToolRouter =
            Arc::new(move |name: &str| routing_toolset.routing_description(name));

        let adapters = DynToolSetAdapter::from_toolset(toolset, context, request_context);

        let handle = ToolServer::new().run();
        for adapter in adapters {
            handle
                .add_tool(adapter)
                .await
                .expect("failed to register tool");
        }

        let agent = match self.model.provider() {
            ModelProvider::Anthropic => {
                let model = self.anthropic.completion_model(self.model.api_id());
                ProviderAgent::Anthropic(self.build_agent(model, handle, system_prompt))
            }
            ModelProvider::OpenAi => {
                let client = self
                    .openai
                    .as_ref()
                    .expect("OPENAI_API_KEY must be set to use OpenAI models");
                // Non-strict tools: send tool schemas verbatim instead of
                // letting rig sanitize them into OpenAI's strict subset,
                // which silently forces every optional parameter into
                // `required`.
                let model = client
                    .completion_model(self.model.api_id())
                    .with_non_strict_tools();
                ProviderAgent::OpenAi(self.build_agent(model, handle, system_prompt))
            }
        };

        Session {
            agent,
            history: Vec::new(),
            max_turns: self.max_turns,
            routing,
        }
    }
}

/// A rig agent bound to the provider that serves the session's model.
enum ProviderAgent {
    Anthropic(Agent<anthropic::completion::CompletionModel>),
    OpenAi(Agent<openai::responses_api::ResponsesCompletionModel>),
}

/// A single streaming conversation session.
pub struct Session {
    agent: ProviderAgent,
    history: Vec<Message>,
    max_turns: usize,
    routing: ToolRouter,
}

impl Session {
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

        let stream = match &self.agent {
            ProviderAgent::Anthropic(agent) => {
                run_stream(
                    agent,
                    prompt.clone(),
                    history.to_vec(),
                    self.max_turns,
                    self.routing.clone(),
                )
                .await
            }
            ProviderAgent::OpenAi(agent) => {
                run_stream(
                    agent,
                    prompt.clone(),
                    history.to_vec(),
                    self.max_turns,
                    self.routing.clone(),
                )
                .await
            }
        };

        Ok(stream)
    }

    /// Get the conversation messages accumulated during this session.
    pub fn get_history(&self) -> &[Message] {
        &self.history
    }
}

/// Run the agentic loop on `agent` and adapt rig's stream into the
/// provider-agnostic [`StreamPart`] stream consumed by DCS.
async fn run_stream<M>(
    agent: &Agent<M>,
    prompt: Message,
    history: Vec<Message>,
    max_turns: usize,
    routing: ToolRouter,
) -> ChatCompletionStream<'static>
where
    M: CompletionModel + 'static,
    M::StreamingResponse: GetTokenUsage + Send + Sync,
{
    let (bridge, mut rx) = StreamBridge::channel(routing);

    let mut rig_stream = agent
        .stream_prompt(prompt)
        .with_history(history)
        .multi_turn(max_turns)
        .with_hook(bridge)
        .await;

    let stream = async_stream::stream! {
        let mut thinking_buf = String::new();

        while let Some(item) = rig_stream.next().await {
            while let Ok(part) = rx.try_recv() {
                yield part;
            }
            match item {
                Ok(MultiTurnStreamItem::StreamAssistantItem(
                    StreamedAssistantContent::ReasoningDelta { reasoning, .. },
                )) => {
                    thinking_buf.push_str(&reasoning);
                }
                other => {
                    if !thinking_buf.is_empty() {
                        yield Ok(StreamPart::Thinking(std::mem::take(&mut thinking_buf)));
                    }
                    match other {
                        Ok(MultiTurnStreamItem::FinalResponse(final_resp)) => {
                            let usage = final_resp.usage();
                            yield Ok(StreamPart::Usage(crate::stream::Usage {
                                input_tokens: usage.input_tokens,
                                output_tokens: usage.output_tokens,
                            }));
                        }
                        Err(e) => {
                            yield Err(AgentError::Streaming(e));
                        }
                        _ => {}
                    }
                }
            }
        }
        if !thinking_buf.is_empty() {
            yield Ok(StreamPart::Thinking(std::mem::take(&mut thinking_buf)));
        }
        while let Ok(part) = rx.try_recv() {
            yield part;
        }
    };

    Box::pin(stream)
}
