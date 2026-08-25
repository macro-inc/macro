/// A [`rig_agent::agent::AgentHook`] that bridges rig lifecycle events into
/// [`StreamPart`] items sent through a channel.
use crate::AgentError;
use crate::stream::{McpInfo, StreamPart, ToolCall, ToolResponse, Usage};
use ai_toolset::{SearchableTool, ToolInfo};
use rig_agent::agent::hook::{
    AgentHook, HookContext, InvalidToolCallAction, InvalidToolCallContext, ObservationAction,
    StreamResponseFinish, TextDelta, ToolCallAction, ToolResultAction, ToolResultEvent,
};
use rig_agent::tool::ToolOutput;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Resolves a tool name to its routing [`ToolInfo`] via the session's toolset.
///
/// rig only hands the hook a tool's (mangled) name, so this closure lets the
/// bridge ask the authoritative source — [`ai_toolset::ToolSet::routing_description`]
/// — whether a call is an external/MCP tool and recover its service, original
/// name, and display name. Returns `None` for native tools.
pub type ToolRouter = Arc<dyn Fn(&str) -> Option<ToolInfo> + Send + Sync>;

/// Registers tools loaded on demand (via `SearchTools`) with the live tool
/// server so they are advertised and callable on the next turn.
///
/// Built by the agent layer (which captures the tool-server handle and the
/// session's context); context-erased so the bridge stays generic-free.
pub type RegisterFn =
    Arc<dyn Fn(Vec<SearchableTool>) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

static CANCELLED_REASON: &str = "user cancelled";

/// Retry budget for invalid tool calls recovered via
/// [`StreamBridge::on_invalid_tool_call`]. Lets the common one-shot recovery —
/// the model calls a searchable tool it never loaded, the bridge loads it, the
/// call is retried — succeed, while bounding a model that keeps emitting names
/// that don't exist anywhere. Past the budget the stream fails with
/// `UnknownToolCall`, as it did before recovery existed. Retries also consume
/// multi-turn depth.
pub(crate) const MAX_INVALID_TOOL_CALL_RETRIES: usize = 2;

/// Sends [`StreamPart`] items through an unbounded channel as the RIG agentic
/// loop produces events.
#[derive(Clone)]
pub struct StreamBridge {
    tx: mpsc::UnboundedSender<Result<StreamPart, AgentError>>,
    routing: ToolRouter,
    /// Tools the `SearchTools` tool asked to load this turn, awaiting
    /// registration. Drained in [`Self::on_tool_result`].
    loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
    /// Registers drained tools with the live tool server.
    register_loaded: RegisterFn,
    /// The session's full searchable catalog. Read by
    /// [`Self::on_invalid_tool_call`] to recover calls to tools the model
    /// discovered but never loaded.
    searchable_catalog: Arc<Vec<SearchableTool>>,
    /// the user has requested the stream stop
    cancel: CancellationToken,
}

impl StreamBridge {
    /// Create a bridge and its receiving half.
    ///
    /// `routing` resolves tool names to [`ToolInfo`] so MCP calls can be
    /// tagged as such (see [`ToolRouter`]). `loaded_buffer` / `register_loaded`
    /// power on-demand tool loading: `SearchTools` pushes matches into the
    /// buffer, and the bridge registers them after the tool result, before the
    /// next turn (see [`Self::on_tool_result`]).
    pub fn channel(
        routing: ToolRouter,
        loaded_buffer: Arc<Mutex<Vec<SearchableTool>>>,
        register_loaded: RegisterFn,
        searchable_catalog: Arc<Vec<SearchableTool>>,
        cancel: CancellationToken,
    ) -> (
        Self,
        mpsc::UnboundedReceiver<Result<StreamPart, AgentError>>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Self {
                tx,
                routing,
                loaded_buffer,
                register_loaded,
                searchable_catalog,
                cancel,
            },
            rx,
        )
    }

    /// Clone the sending half of the bridge's channel.
    ///
    /// Lets the stream driver push parts derived from rig stream items
    /// (buffered thinking, usage, errors) into the same ordered channel the
    /// lifecycle hooks send through, so all parts share one FIFO order.
    pub(crate) fn sender(&self) -> mpsc::UnboundedSender<Result<StreamPart, AgentError>> {
        self.tx.clone()
    }
}

/// The model-visible presentation of a tool result as a single JSON value,
/// mirroring what the pre-0.41 string-based hook saw: our adapters return
/// structured JSON on success, so a JSON content block yields its value and
/// plain text is tried as JSON for compatibility.
fn presentation_json(presentation: &ToolOutput) -> Option<serde_json::Value> {
    if let Some(json) = presentation.as_json() {
        return Some(json.clone());
    }
    presentation
        .as_text()
        .and_then(|text| serde_json::from_str(text).ok())
}

/// The hook bodies, as inherent methods so tests can exercise them directly:
/// rig's [`HookContext`] has no public constructor, so the [`AgentHook`] impl
/// below is a thin delegation layer over these.
impl StreamBridge {
    pub(crate) fn handle_text_delta(&self, delta: &str) -> ObservationAction {
        let _ = self.tx.send(Ok(StreamPart::Content(delta.to_owned())));
        if self.cancel.is_cancelled() {
            ObservationAction::stop(CANCELLED_REASON)
        } else {
            ObservationAction::Continue
        }
    }

    /// Recover a tool call the model emitted for a tool that is not advertised
    /// this turn, instead of rig's default fail-fast (which killed the whole
    /// stream and surfaced to the user as a turn that announced a tool call and
    /// then went silent).
    ///
    /// If the name exists in the searchable catalog — the model discovered it
    /// via `SearchTools` (possibly in an earlier conversation turn) but it was
    /// never loaded — load it now and ask the model to retry; the next request
    /// is rebuilt from the live tool server, so the retried call is valid. For
    /// names that exist nowhere, the retry feedback points the model at
    /// `SearchTools` instead of failing the stream on a hallucinated name.
    pub(crate) async fn handle_invalid_tool_call(
        &self,
        tool_name: &str,
    ) -> Option<InvalidToolCallAction> {
        match self
            .searchable_catalog
            .iter()
            .find(|tool| tool.name == tool_name)
        {
            Some(tool) => {
                (self.register_loaded)(vec![tool.clone()]).await;
                tracing::info!(
                    tool = %tool_name,
                    "auto-loaded searchable tool the model called without loading"
                );
                Some(InvalidToolCallAction::retry(format!(
                    "The tool `{tool_name}` exists but was not loaded when you called it. \
                     It is loaded now — call it again with the same arguments."
                )))
            }
            None => Some(InvalidToolCallAction::retry(format!(
                "Unknown tool `{tool_name}`: no tool with that name exists in this session \
                 or its connected integrations. Use `SearchTools` to find the \
                 right tool, or continue without it."
            ))),
        }
    }

    pub(crate) fn handle_tool_call(
        &self,
        tool_name: &str,
        tool_call_id: Option<&str>,
        internal_call_id: &str,
        args: &str,
    ) -> ToolCallAction {
        if self.cancel.is_cancelled() {
            return ToolCallAction::stop(CANCELLED_REASON);
        }
        let json = serde_json::from_str(args)
            .ok()
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        let id = tool_call_id.unwrap_or(internal_call_id).to_owned();
        let mcp = (self.routing)(tool_name).map(|i| match i {
            ToolInfo::ExternalTool {
                service_name,
                tool_name,
                display_name,
            } => McpInfo {
                service: service_name,
                tool_name,
                display_name,
            },
        });
        let _ = self.tx.send(Ok(StreamPart::ToolCall(ToolCall {
            id,
            name: tool_name.to_owned(),
            json,
            mcp,
        })));
        ToolCallAction::Run
    }

    pub(crate) async fn handle_tool_result(
        &self,
        tool_name: &str,
        tool_call_id: Option<&str>,
        internal_call_id: &str,
        presentation: &ToolOutput,
        is_success: bool,
    ) -> ToolResultAction {
        // Register any tools `SearchTools` asked to load. This fires after the
        // tool executes and before the next turn's request is built, so loaded
        // tools are advertised + callable next turn. (The lock guard is dropped
        // before the await.)
        let pending: Vec<SearchableTool> = {
            let mut buf = self.loaded_buffer.lock().expect("loaded_buffer poisoned");
            std::mem::take(&mut *buf)
        };
        if !pending.is_empty() {
            (self.register_loaded)(pending).await;
        }

        let id = tool_call_id.unwrap_or(internal_call_id).to_owned();
        let response = if is_success && let Some(json) = presentation_json(presentation) {
            ToolResponse::Json {
                id,
                json,
                name: tool_name.to_owned(),
            }
        } else {
            ToolResponse::Err {
                id,
                name: tool_name.to_owned(),
                description: presentation.render(),
            }
        };
        let _ = self.tx.send(Ok(StreamPart::ToolResponse(response)));
        ToolResultAction::Keep
    }

    pub(crate) fn handle_usage(&self, usage: rig_core::completion::Usage) -> ObservationAction {
        let _ = self.tx.send(Ok(StreamPart::Usage(Usage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
        })));
        ObservationAction::Continue
    }
}

impl AgentHook for StreamBridge {
    async fn on_text_delta(&self, _ctx: &HookContext, event: TextDelta<'_>) -> ObservationAction {
        self.handle_text_delta(event.delta)
    }

    async fn on_invalid_tool_call(
        &self,
        _ctx: &HookContext,
        event: &InvalidToolCallContext,
    ) -> Option<InvalidToolCallAction> {
        self.handle_invalid_tool_call(&event.tool_name).await
    }

    async fn on_tool_call(
        &self,
        _ctx: &HookContext,
        event: rig_agent::agent::hook::ToolCall<'_>,
    ) -> ToolCallAction {
        self.handle_tool_call(
            event.tool_name,
            event.tool_call_id,
            event.internal_call_id,
            event.args,
        )
    }

    async fn on_tool_result(
        &self,
        _ctx: &HookContext,
        event: ToolResultEvent<'_>,
    ) -> ToolResultAction {
        self.handle_tool_result(
            event.tool_name,
            event.tool_call_id,
            event.internal_call_id,
            event.presentation,
            event.raw_result.is_success(),
        )
        .await
    }

    async fn on_stream_response_finish(
        &self,
        _ctx: &HookContext,
        event: StreamResponseFinish<'_>,
    ) -> ObservationAction {
        self.handle_usage(event.usage)
    }
}
