/// A [`rig_core::agent::PromptHook`] that bridges RIG lifecycle events into
/// [`StreamPart`] items sent through a channel.
use crate::AgentError;
use crate::stream::{McpInfo, StreamPart, ToolCall, ToolResponse, Usage};
use ai_toolset::ToolInfo;
use rig_core::agent::{HookAction, PromptHook, ToolCallHookAction};
use rig_core::completion::{CompletionModel, GetTokenUsage};
use rig_core::message::Message;
use std::sync::Arc;
use tokio::sync::mpsc;

/// Resolves a tool name to its routing [`ToolInfo`] via the session's toolset.
///
/// rig only hands the hook a tool's (mangled) name, so this closure lets the
/// bridge ask the authoritative source — [`ai_toolset::ToolSet::routing_description`]
/// — whether a call is an external/MCP tool and recover its service, original
/// name, and display name. Returns `None` for native tools.
pub type ToolRouter = Arc<dyn Fn(&str) -> Option<ToolInfo> + Send + Sync>;

/// Sends [`StreamPart`] items through an unbounded channel as the RIG agentic
/// loop produces events.
#[derive(Clone)]
pub struct StreamBridge {
    tx: mpsc::UnboundedSender<Result<StreamPart, AgentError>>,
    routing: ToolRouter,
}

impl StreamBridge {
    /// Create a bridge and its receiving half.
    ///
    /// `routing` resolves tool names to [`ToolInfo`] so MCP calls can be
    /// tagged as such (see [`ToolRouter`]).
    pub fn channel(
        routing: ToolRouter,
    ) -> (
        Self,
        mpsc::UnboundedReceiver<Result<StreamPart, AgentError>>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Self { tx, routing }, rx)
    }
}

impl<M> PromptHook<M> for StreamBridge
where
    M: CompletionModel,
    M::StreamingResponse: GetTokenUsage + Send + Sync,
{
    async fn on_text_delta(&self, text_delta: &str, _aggregated_text: &str) -> HookAction {
        let _ = self.tx.send(Ok(StreamPart::Content(text_delta.to_owned())));
        HookAction::Continue
    }

    async fn on_tool_call(
        &self,
        tool_name: &str,
        tool_call_id: Option<String>,
        internal_call_id: &str,
        args: &str,
    ) -> ToolCallHookAction {
        let json = serde_json::from_str(args).unwrap_or(serde_json::Value::Null);
        let id = tool_call_id.unwrap_or_else(|| internal_call_id.to_owned());
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
        ToolCallHookAction::Continue
    }

    async fn on_tool_result(
        &self,
        tool_name: &str,
        tool_call_id: Option<String>,
        internal_call_id: &str,
        _args: &str,
        result: &str,
    ) -> HookAction {
        let id = tool_call_id.unwrap_or_else(|| internal_call_id.to_owned());
        let response = match serde_json::from_str::<serde_json::Value>(result) {
            Ok(json) => ToolResponse::Json {
                id,
                json,
                name: tool_name.to_owned(),
            },
            Err(_) => ToolResponse::Err {
                id,
                name: tool_name.to_owned(),
                description: result.to_owned(),
            },
        };
        let _ = self.tx.send(Ok(StreamPart::ToolResponse(response)));
        HookAction::Continue
    }

    async fn on_stream_completion_response_finish(
        &self,
        _prompt: &Message,
        response: &M::StreamingResponse,
    ) -> HookAction {
        if let Some(usage) = response.token_usage() {
            let _ = self.tx.send(Ok(StreamPart::Usage(Usage {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
            })));
        }
        HookAction::Continue
    }
}
