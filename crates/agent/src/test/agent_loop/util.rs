//! Shared boilerplate for the agent-loop behavior tests.
//!
//! Every test in this module drives the public session surface used by DCS —
//! [`AgentLoop`] → [`Session::cancellable`] → [`Session::send_message`] — with a
//! fake completion model injected via [`AgentLoop::test_session`]. That exercises
//! the real per-session wiring (tool adapters, cancellation token) without
//! talking to a provider. The helpers here remove the repeated setup so each
//! test reads as the behavior it asserts.

use crate::AgentLoop;
use crate::Session;
use crate::error::AgentError;
use crate::stream::{ChatCompletionStream, StreamPart, ToolCall, ToolResponse};
use ai_toolset::{AsyncTool, AsyncToolCollection, ToolSet as AiToolSet};
use ai_usage::{AiFeature, UsageContext, UsageEvent, UsageRecorder};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use rig_core::completion::{CompletionModel, GetTokenUsage};
use rig_core::message::Message;
use schemars::JsonSchema;
use serde::Serialize;
use std::sync::Arc;

/// A [`UsageRecorder`] that drops every event. Used when token accounting is not
/// what the test is checking.
pub(crate) struct NoOpRecorder;

impl UsageRecorder for NoOpRecorder {
    fn record(&self, _event: UsageEvent) {}
}

/// An [`AgentLoop`] with small turn/token budgets that drops usage events.
pub(crate) fn test_loop() -> AgentLoop {
    AgentLoop::new(Arc::new(NoOpRecorder))
        .with_max_turns(8)
        .with_max_tokens(1024)
}

/// A stable test user id.
pub(crate) fn test_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("test@macro.com").expect("valid user id")
}

/// The usage context every test session runs under.
pub(crate) fn usage_ctx() -> UsageContext {
    UsageContext::new(AiFeature::Chat, test_user())
}

/// A toolset holding a single tool `T` whose context is the whole service
/// context `C`.
pub(crate) fn single_tool_set<T, C>() -> Arc<dyn AiToolSet<C> + Send + Sync>
where
    C: Clone + Send + Sync + 'static,
    T: JsonSchema + AsyncTool<C> + for<'de> serde::Deserialize<'de> + Send + Sync + 'static,
    T::Output: Serialize + JsonSchema + 'static,
{
    Arc::new(AsyncToolCollection::<C>::new().add_tool::<T, C>())
}

/// Erase a built [`AsyncToolCollection`] into the toolset trait object a session
/// takes. For tests that need more than one tool type registered.
pub(crate) fn tool_set<C>(collection: AsyncToolCollection<C>) -> Arc<dyn AiToolSet<C> + Send + Sync>
where
    C: Clone + Send + Sync + 'static,
{
    Arc::new(collection)
}

/// Build a session on a default [`test_loop`] backed by the scripted `model`.
pub(crate) async fn session<C, M>(
    toolset: Arc<dyn AiToolSet<C> + Send + Sync>,
    context: Arc<C>,
    model: M,
) -> Session
where
    C: Clone + Send + Sync + 'static,
    M: CompletionModel + 'static,
    M::StreamingResponse: GetTokenUsage + Send + Sync,
{
    test_loop()
        .test_session(toolset, context, "test preamble", usage_ctx(), model)
        .await
}

/// Everything a session emitted: the ordered [`StreamPart`]s plus the terminal
/// error, if the stream ended with one. The agent loop breaks on the first
/// error, so `error` is at most one and always last.
pub(crate) struct Collected {
    /// Parts yielded before the stream ended.
    pub(crate) parts: Vec<StreamPart>,
    /// The terminal error, if the stream ended with one.
    pub(crate) error: Option<AgentError>,
}

impl Collected {
    /// Every tool call the assistant made.
    pub(crate) fn tool_calls(&self) -> Vec<&ToolCall> {
        self.parts
            .iter()
            .filter_map(|part| match part {
                StreamPart::ToolCall(call) => Some(call),
                _ => None,
            })
            .collect()
    }

    /// Every tool response produced.
    pub(crate) fn tool_responses(&self) -> Vec<&ToolResponse> {
        self.parts
            .iter()
            .filter_map(|part| match part {
                StreamPart::ToolResponse(response) => Some(response),
                _ => None,
            })
            .collect()
    }

    /// The tool response for a given call id, if any.
    pub(crate) fn tool_response(&self, call_id: &str) -> Option<&ToolResponse> {
        self.tool_responses()
            .into_iter()
            .find(|response| response_id(response) == call_id)
    }

    /// The concatenated assistant text content.
    pub(crate) fn content(&self) -> String {
        self.parts
            .iter()
            .filter_map(|part| match part {
                StreamPart::Content(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// The call id a tool response corresponds to.
pub(crate) fn response_id(response: &ToolResponse) -> &str {
    match response {
        ToolResponse::Json { id, .. } | ToolResponse::Err { id, .. } => id,
    }
}

/// Drain a stream to completion, separating parts from the terminal error.
pub(crate) async fn collect(mut stream: ChatCompletionStream<'_>) -> Collected {
    let mut parts = Vec::new();
    let mut error = None;
    while let Some(item) = stream.next().await {
        match item {
            Ok(part) => parts.push(part),
            Err(err) => error = Some(err),
        }
    }
    Collected { parts, error }
}

/// Pull the next stream part, returning `None` if the stream ends, errors, or
/// produces nothing within `within`. Lets a test observe the parts emitted
/// *while* a long-running tool keeps the underlying agent future busy, without
/// hanging if a part that should have arrived never does.
pub(crate) async fn next_within(
    stream: &mut ChatCompletionStream<'_>,
    within: std::time::Duration,
) -> Option<StreamPart> {
    match tokio::time::timeout(within, stream.next()).await {
        Ok(Some(Ok(part))) => Some(part),
        _ => None,
    }
}

/// Send a single user `prompt` and drain the resulting stream.
pub(crate) async fn drive(session: &mut Session, prompt: &str) -> Collected {
    let stream = session
        .send_message(vec![Message::user(prompt)])
        .await
        .expect("send_message should start the stream");
    collect(stream).await
}
