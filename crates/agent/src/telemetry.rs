//! GenAI span enrichment for the agent loop.
//!
//! rig opens the OpenTelemetry GenAI spans — `invoke_agent` (adopting ours, see
//! [`crate::Session::send_message`]), one `chat` span per model call and one
//! `execute_tool` span per tool call — and records the structural fields:
//! provider, model, response id, token usage, tool name and call id. Its own
//! content recording (`record_content_telemetry`) stays **off**: it is
//! unbounded, so every `chat` span would carry the whole conversation so far.
//! This module records what Datadog's evaluations need on top, under the
//! content policy and size bounds of [`genai_telemetry`]:
//!
//! - on each `chat` span: the tool definitions offered (`gen_ai.tool.definitions`,
//!   what a tool-selection judge grades against), the input messages, the
//!   system instructions, request parameters, the conversation id and — once
//!   the turn finishes — the output messages and finish reason;
//! - on the `invoke_agent` span: the run's token usage, its input (the prompt)
//!   and its output (the final answer), which a session-level judge reads.
//!
//! [`TracedModel`] sits between rig and the provider. rig instruments the
//! model call with the `chat` span, so inside `completion` / `stream` the
//! current span *is* that span: the request side is recorded there and the
//! span is parked in the shared [`GenAiContext`]. The response side arrives
//! through rig's per-turn hook ([`ChatSpanHook`]) after the provider stream
//! ends, when the current span is the agent span again.

#[cfg(test)]
mod test;

use std::sync::{Arc, Mutex, OnceLock};

use genai_telemetry::messages::{self, MediaSource};
use genai_telemetry::{
    ContentPolicy, GenAiSpanExt as _, attr, bound_messages, bound_tool_definitions,
};
use rig_agent::agent::hook::{AgentHook, HookContext, ModelTurnAction, ModelTurnFinished};
use rig_core::OneOrMany;
use rig_core::completion::{
    CompletionError, CompletionModel, CompletionRequest, CompletionResponse, ToolDefinition, Usage,
};
use rig_core::message::{
    AssistantContent, DocumentSourceKind, Message, MimeType, Reasoning, ReasoningContent,
    ToolResultContent, UserContent,
};
use rig_core::streaming::StreamingCompletionResponse;

/// Session-scoped telemetry state shared by the traced model, the hooks and
/// the agent span. Cheap to clone; all clones share one state.
#[derive(Clone, Default)]
pub(crate) struct GenAiContext(Arc<Inner>);

#[derive(Default)]
struct Inner {
    /// The session (chat) every span of this run belongs to.
    conversation_id: Option<String>,
    /// Label for the agent, e.g. the AI feature driving it.
    agent_name: String,
    policy: ContentPolicy,
    /// Whether anything is recorded at all. Off, every `record_*` is a no-op
    /// and the model call's span is never parked.
    enabled: bool,
    /// The routed `(provider, model)`, set once routing has decided.
    model: OnceLock<(String, String)>,
    /// The `chat` span of the model call in flight: parked by
    /// [`TracedModel`] on request, consumed by [`ChatSpanHook`] on response.
    /// Holding the handle keeps the span open, so it is always taken out again.
    chat_span: Mutex<Option<tracing::Span>>,
}

impl GenAiContext {
    pub(crate) fn new(
        conversation_id: Option<String>,
        agent_name: String,
        policy: ContentPolicy,
        enabled: bool,
    ) -> Self {
        Self(Arc::new(Inner {
            conversation_id,
            agent_name,
            policy,
            enabled,
            model: OnceLock::new(),
            chat_span: Mutex::new(None),
        }))
    }

    /// Whether this context records anything (see
    /// [`crate::AgentLoop::with_genai_telemetry`]).
    pub(crate) fn enabled(&self) -> bool {
        self.0.enabled
    }

    pub(crate) fn conversation_id(&self) -> Option<&str> {
        self.0.conversation_id.as_deref()
    }

    pub(crate) fn agent_name(&self) -> &str {
        &self.0.agent_name
    }

    /// Record the provider and model routing settled on. First call wins.
    pub(crate) fn set_model(&self, provider: &str, model: &str) {
        let _ = self.0.model.set((provider.to_owned(), model.to_owned()));
    }

    pub(crate) fn provider_name(&self) -> Option<&str> {
        self.0.model.get().map(|(provider, _)| provider.as_str())
    }

    pub(crate) fn model_name(&self) -> Option<&str> {
        self.0.model.get().map(|(_, model)| model.as_str())
    }

    /// Record the request side of a model call on the current span (rig's
    /// `chat` span when called from [`TracedModel`]) and park that span for
    /// [`Self::record_response`].
    fn record_request(&self, request: &CompletionRequest) {
        if !self.0.enabled {
            return;
        }
        let span = tracing::Span::current();
        let policy = &self.0.policy;

        if let Some(conversation_id) = self.conversation_id() {
            span.set_str(attr::CONVERSATION_ID, conversation_id);
        }
        if let Some(max_tokens) = request.max_tokens {
            span.set_u64(attr::REQUEST_MAX_TOKENS, max_tokens);
        }
        if let Some(temperature) = request.temperature {
            span.set_f64(attr::REQUEST_TEMPERATURE, temperature);
        }
        // Tool definitions are our own code, not user content: always recorded.
        if !request.tools.is_empty() {
            let definitions = request.tools.iter().map(tool_definition_json).collect();
            let (json, truncated) = bound_tool_definitions(definitions, &policy.limits);
            span.set_str(attr::TOOL_DEFINITIONS, json);
            if truncated {
                span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
            }
        }
        if policy.capture {
            let (system, input) = split_system(request);
            if let Some(system) = system {
                let bounded = bound_messages(messages::system_instructions(system), &policy.limits);
                span.set_str(attr::SYSTEM_INSTRUCTIONS, bounded.json);
                if bounded.truncated {
                    span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
                }
            }
            let bounded = bound_messages(input, &policy.limits);
            span.set_str(attr::INPUT_MESSAGES, bounded.json);
            if bounded.omitted > 0 {
                span.set_u64(attr::MACRO_INPUT_MESSAGES_OMITTED, bounded.omitted as u64);
            }
            if bounded.truncated {
                span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
            }
        }

        *self.0.chat_span.lock().expect("chat span slot poisoned") = Some(span);
    }

    /// Record the response side of the model call whose request was recorded
    /// last, then release the parked span so it can close.
    fn record_response(&self, content: &OneOrMany<AssistantContent>) {
        let Some(span) = self
            .0
            .chat_span
            .lock()
            .expect("chat span slot poisoned")
            .take()
        else {
            return;
        };
        let finish_reason = finish_reason(content);
        span.set_str_array(attr::RESPONSE_FINISH_REASONS, [finish_reason]);
        if self.0.policy.capture {
            let message = messages::output_message(
                messages::ROLE_ASSISTANT,
                assistant_parts(content),
                finish_reason,
            );
            let bounded = bound_messages(vec![message], &self.0.policy.limits);
            span.set_str(attr::OUTPUT_MESSAGES, bounded.json);
            if bounded.truncated {
                span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
            }
        }
    }

    /// Record that an agent run failed: `error_type` names the class of
    /// failure, `finish_reason` how the run stopped (`error`, `cancelled`) and
    /// `detail` the message, which is recorded bounded when content may be
    /// captured and left out otherwise - a provider's error text can quote the
    /// request.
    pub(crate) fn record_agent_failure(
        &self,
        agent_span: &tracing::Span,
        error_type: &str,
        finish_reason: &'static str,
        detail: &str,
    ) {
        if !self.0.enabled {
            return;
        }
        agent_span.set_str_array(attr::RESPONSE_FINISH_REASONS, [finish_reason]);
        let description = if self.0.policy.capture {
            genai_telemetry::truncate_chars(detail, self.0.policy.limits.max_part_chars)
                .into_owned()
        } else {
            format!("the agent run ended with {error_type}")
        };
        agent_span.set_error(error_type, description);
    }

    /// Release the parked `chat` span, if any, so it closes now. Called when
    /// a run ends on a path that fires no turn hook - a provider error, a
    /// cancellation, exhausted invalid-tool retries, the consumer dropping the
    /// stream - and a no-op when the hook already released it.
    pub(crate) fn finish_run(&self) {
        self.0
            .chat_span
            .lock()
            .expect("chat span slot poisoned")
            .take();
    }

    /// Record the prompt of an agent run as the agent span's input.
    pub(crate) fn record_agent_input(&self, agent_span: &tracing::Span, prompt: &Message) {
        if !self.0.enabled || !self.0.policy.capture {
            return;
        }
        let bounded = bound_messages(message_json(prompt), &self.0.policy.limits);
        agent_span.set_str(attr::INPUT_MESSAGES, bounded.json);
        if bounded.truncated {
            agent_span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
        }
    }

    /// Record the final answer and aggregate usage of an agent run on the
    /// agent span. Usage is structure and always recorded; the answer follows
    /// the content policy.
    pub(crate) fn record_agent_output(
        &self,
        agent_span: &tracing::Span,
        output: &str,
        usage: &Usage,
    ) {
        if !self.0.enabled {
            return;
        }
        agent_span.set_u64(attr::USAGE_INPUT_TOKENS, usage.input_tokens);
        agent_span.set_u64(attr::USAGE_OUTPUT_TOKENS, usage.output_tokens);
        agent_span.set_str_array(attr::RESPONSE_FINISH_REASONS, [attr::finish_reason::STOP]);
        if !self.0.policy.capture {
            return;
        }
        let message = messages::output_message(
            messages::ROLE_ASSISTANT,
            vec![messages::text_part(output)],
            attr::finish_reason::STOP,
        );
        let bounded = bound_messages(vec![message], &self.0.policy.limits);
        agent_span.set_str(attr::OUTPUT_MESSAGES, bounded.json);
        if bounded.truncated {
            agent_span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
        }
    }
}

/// A [`CompletionModel`] that records the request side of every model call
/// on the current (`chat`) span before delegating to the provider model.
#[derive(Clone)]
pub(crate) struct TracedModel<M> {
    inner: M,
    telemetry: GenAiContext,
}

impl<M> TracedModel<M> {
    pub(crate) fn new(inner: M, telemetry: GenAiContext) -> Self {
        Self { inner, telemetry }
    }
}

impl<M: CompletionModel> CompletionModel for TracedModel<M> {
    type Response = M::Response;
    type StreamingResponse = M::StreamingResponse;
    type Client = M::Client;

    fn make(client: &Self::Client, model: impl Into<String>) -> Self {
        Self {
            inner: M::make(client, model),
            telemetry: GenAiContext::default(),
        }
    }

    async fn completion(
        &self,
        request: CompletionRequest,
    ) -> Result<CompletionResponse<Self::Response>, CompletionError> {
        self.telemetry.record_request(&request);
        self.inner.completion(request).await
    }

    async fn stream(
        &self,
        request: CompletionRequest,
    ) -> Result<StreamingCompletionResponse<Self::StreamingResponse>, CompletionError> {
        self.telemetry.record_request(&request);
        self.inner.stream(request).await
    }

    fn composes_native_output_with_tools(&self) -> bool {
        self.inner.composes_native_output_with_tools()
    }
}

/// rig hook completing the `chat` span [`TracedModel`] parked: records the
/// model's output and finish reason once the turn's response is in.
///
/// `ModelTurnFinished` is the one per-turn event both of rig's surfaces fire
/// for every accepted turn, tool-only turns included (`StreamResponseFinish`
/// skips those). A turn rig recovers from an invalid tool call fires nothing;
/// its span is released, without output, when the next call parks its own.
#[derive(Clone)]
pub(crate) struct ChatSpanHook(pub(crate) GenAiContext);

impl AgentHook for ChatSpanHook {
    async fn on_model_turn_finished(
        &self,
        _ctx: &HookContext,
        event: ModelTurnFinished<'_>,
    ) -> ModelTurnAction {
        self.0.record_response(event.content);
        ModelTurnAction::Continue
    }
}

/// Why the model stopped, as far as rig's normalized content tells: a turn
/// with tool calls stopped to call them, anything else is a natural stop
/// (rig does not retain a provider's `length` / `content_filter` reasons).
fn finish_reason(content: &OneOrMany<AssistantContent>) -> &'static str {
    if content
        .iter()
        .any(|content| matches!(content, AssistantContent::ToolCall(_)))
    {
        attr::finish_reason::TOOL_CALL
    } else {
        attr::finish_reason::STOP
    }
}

/// Separate the system instructions (the preamble and any `System` messages,
/// which rig prepends to the history) from the chat messages.
fn split_system(request: &CompletionRequest) -> (Option<String>, Vec<serde_json::Value>) {
    let mut system: Vec<String> = request.preamble.iter().cloned().collect();
    let mut input = Vec::new();
    for message in request.chat_history.iter() {
        match message {
            Message::System { content } => system.push(content.clone()),
            other => input.extend(message_json(other)),
        }
    }
    let system = (!system.is_empty()).then(|| system.join("\n\n"));
    (system, input)
}

fn tool_definition_json(definition: &ToolDefinition) -> serde_json::Value {
    messages::tool_definition(
        &definition.name,
        &definition.description,
        definition.parameters.clone(),
    )
}

/// One rig message as semconv messages. A user message carrying tool results
/// yields a `tool` message for them (and a `user` message for anything else),
/// matching the semconv role split.
fn message_json(message: &Message) -> Vec<serde_json::Value> {
    match message {
        Message::System { content } => vec![messages::message(
            messages::ROLE_SYSTEM,
            vec![messages::text_part(content.clone())],
        )],
        Message::User { content } => {
            let (tool_parts, user_parts): (Vec<_>, Vec<_>) = content
                .iter()
                .partition(|content| matches!(content, UserContent::ToolResult(_)));
            let mut out = Vec::new();
            if !tool_parts.is_empty() {
                out.push(messages::message(
                    messages::ROLE_TOOL,
                    tool_parts.into_iter().map(user_part).collect(),
                ));
            }
            if !user_parts.is_empty() {
                out.push(messages::message(
                    messages::ROLE_USER,
                    user_parts.into_iter().map(user_part).collect(),
                ));
            }
            out
        }
        Message::Assistant { content, .. } => vec![messages::message(
            messages::ROLE_ASSISTANT,
            assistant_parts(content),
        )],
    }
}

fn user_part(content: &UserContent) -> serde_json::Value {
    match content {
        UserContent::Text(text) => messages::text_part(text.text.clone()),
        UserContent::ToolResult(result) => {
            messages::tool_call_response_part(Some(&result.id), tool_result_json(&result.content))
        }
        UserContent::Image(image) => media_part(
            "image",
            image.media_type.as_ref().map(MimeType::to_mime_type),
            &image.data,
        ),
        UserContent::Audio(audio) => media_part(
            "audio",
            audio.media_type.as_ref().map(MimeType::to_mime_type),
            &audio.data,
        ),
        UserContent::Video(video) => media_part(
            "video",
            video.media_type.as_ref().map(MimeType::to_mime_type),
            &video.data,
        ),
        UserContent::Document(document) => media_part(
            "document",
            document.media_type.as_ref().map(MimeType::to_mime_type),
            &document.data,
        ),
    }
}

/// A tool result as the `response` of a `tool_call_response` part: a lone
/// text or JSON item as itself, several items as an array.
fn tool_result_json(content: &OneOrMany<ToolResultContent>) -> serde_json::Value {
    let mut items: Vec<serde_json::Value> = content
        .iter()
        .map(|item| match item {
            ToolResultContent::Text(text) => serde_json::Value::String(text.text.clone()),
            ToolResultContent::Json { value } => value.clone(),
            ToolResultContent::Image(image) => media_part(
                "image",
                image.media_type.as_ref().map(MimeType::to_mime_type),
                &image.data,
            ),
        })
        .collect();
    if items.len() == 1 {
        items.remove(0)
    } else {
        serde_json::Value::Array(items)
    }
}

fn assistant_parts(content: &OneOrMany<AssistantContent>) -> Vec<serde_json::Value> {
    content
        .iter()
        .filter_map(|content| match content {
            AssistantContent::Text(text) => Some(messages::text_part(text.text.clone())),
            AssistantContent::ToolCall(call) => Some(messages::tool_call_part(
                Some(&call.id),
                &call.function.name,
                call.function.arguments.clone(),
            )),
            AssistantContent::Reasoning(reasoning) => {
                reasoning_text(reasoning).map(messages::reasoning_part)
            }
            AssistantContent::Image(image) => Some(media_part(
                "image",
                image.media_type.as_ref().map(MimeType::to_mime_type),
                &image.data,
            )),
        })
        .collect()
}

/// The readable text of a reasoning block; `None` when it is entirely
/// encrypted or redacted.
fn reasoning_text(reasoning: &Reasoning) -> Option<String> {
    let text: Vec<&str> = reasoning
        .content
        .iter()
        .filter_map(|content| match content {
            ReasoningContent::Text { text, .. } => Some(text.as_str()),
            ReasoningContent::Summary(summary) => Some(summary.as_str()),
            // Encrypted, redacted, or a variant added later: nothing readable.
            _ => None,
        })
        .collect();
    (!text.is_empty()).then(|| text.join("\n"))
}

fn media_part(
    modality: &str,
    mime_type: Option<&str>,
    data: &DocumentSourceKind,
) -> serde_json::Value {
    let source = match data {
        DocumentSourceKind::Url(uri) => MediaSource::Uri(uri.clone()),
        DocumentSourceKind::FileId(file_id) => MediaSource::FileId(file_id.clone()),
        // Base64, raw bytes, inline strings: never copied onto a span.
        _ => MediaSource::Inline,
    };
    messages::media_part(modality, mime_type, source)
}
