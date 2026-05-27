use crate::AgentError;
/// A [`rig_core::agent::PromptHook`] that bridges RIG lifecycle events into
/// [`StreamPart`] items sent through a channel.
use crate::stream::{StreamPart, ToolCall, ToolResponse, Usage};
use rig_core::agent::{HookAction, PromptHook, ToolCallHookAction};
use rig_core::completion::{CompletionModel, GetTokenUsage};
use rig_core::message::Message;
use tokio::sync::mpsc;

/// Sends [`StreamPart`] items through an unbounded channel as the RIG agentic
/// loop produces events.
#[derive(Clone)]
pub struct StreamBridge {
    tx: mpsc::UnboundedSender<Result<StreamPart, AgentError>>,
}

impl StreamBridge {
    /// Create a bridge and its receiving half.
    pub fn channel() -> (
        Self,
        mpsc::UnboundedReceiver<Result<StreamPart, AgentError>>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Self { tx }, rx)
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
        let _ = self.tx.send(Ok(StreamPart::ToolCall(ToolCall {
            id,
            name: tool_name.to_owned(),
            json,
            mcp: None,
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
