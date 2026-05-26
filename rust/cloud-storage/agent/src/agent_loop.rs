/// The main entry point: [`AgentLoop`] and [`Session`].
use crate::anthropic_model::AnthropicModel;
use crate::error::AgentError;
use crate::hook::StreamBridge;
use crate::model::AgentModel;
use crate::stream::{ChatCompletionStream, StreamPart};
use crate::tool_adapter::DynToolSetAdapter;
use ai_toolset::{RequestContext, ToolSet as AiToolSet};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use rig_core::agent::{Agent, MultiTurnStreamItem};
use rig_core::client::{CompletionClient, ProviderClient};
use rig_core::message::Message;
use rig_core::providers::anthropic;
use rig_core::streaming::{StreamedAssistantContent, StreamingPrompt};
use rig_core::tool::server::ToolServer;
use std::sync::{Arc, RwLock};

const DEFAULT_MAX_TURNS: usize = 16;
const DEFAULT_MAX_TOKENS: u64 = 16_000;

/// Factory for creating per-request agent sessions.
///
/// Holds the Anthropic client. Tools and system prompt are provided
/// per-session since they vary by request (MCP tools are per-user,
/// system prompt depends on toolset selection).
pub struct AgentLoop {
    client: anthropic::Client,
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
    /// Create an `AgentLoop` with the Anthropic client from the environment
    /// and the default model (Opus 4.7).
    pub fn new() -> Self {
        let client = anthropic::Client::from_env().expect("ANTHROPIC_API_KEY must be set");
        Self {
            client,
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

        let adapters = DynToolSetAdapter::from_toolset(toolset, context, request_context);

        let handle = ToolServer::new().run();
        for adapter in adapters {
            handle
                .add_tool(adapter)
                .await
                .expect("failed to register tool");
        }

        let raw_model = self.client.completion_model(self.model.api_id());
        let model = AnthropicModel::new(raw_model);

        let agent = rig_core::agent::AgentBuilder::new(model)
            .tool_server_handle(handle)
            .default_max_turns(self.max_turns)
            .max_tokens(self.max_tokens)
            .additional_params(self.model.thinking_params())
            .preamble(system_prompt)
            .build();

        Session {
            agent,
            history: Vec::new(),
            max_turns: self.max_turns,
        }
    }
}

/// A single streaming conversation session.
pub struct Session {
    agent: Agent<AnthropicModel>,
    history: Vec<Message>,
    max_turns: usize,
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

        #[cfg(feature = "debug-messages")]
        dump_messages("agent_input.log", &self.history);

        let (bridge, mut rx) = StreamBridge::channel();

        let mut rig_stream = self
            .agent
            .stream_prompt(prompt.clone())
            .with_history(history.to_vec())
            .multi_turn(self.max_turns)
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
                                #[cfg(feature = "debug-messages")]
                                if let Some(history) = final_resp.history() {
                                    dump_messages("agent_output.log", history);
                                }
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

        Ok(Box::pin(stream))
    }

    /// Get the conversation messages accumulated during this session.
    pub fn get_history(&self) -> &[Message] {
        &self.history
    }
}

#[cfg(feature = "debug-messages")]
fn dump_messages(filename: &str, messages: &[Message]) {
    use std::io::Write;

    let path = std::path::PathBuf::from(filename);
    match serde_json::to_string_pretty(messages) {
        Ok(json) => match std::fs::File::create(&path) {
            Ok(mut f) => {
                let _ = f.write_all(json.as_bytes());
                tracing::info!(path = %path.display(), "wrote message chain");
            }
            Err(e) => tracing::warn!(error = %e, path = %path.display(), "failed to write"),
        },
        Err(e) => tracing::warn!(error = %e, "failed to serialize message chain"),
    }
}
