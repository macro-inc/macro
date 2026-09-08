//! GenAI spans projected from a live session's ACP frames.
//!
//! Every harness a session can run on - a sandboxed OpenCode, a Cursor cloud
//! agent, Macro's own in-process agent, an external `macrod` - speaks ACP
//! through the [`SessionActor`](super::actors::SessionActor), and the actor
//! sees every frame in both directions exactly once. So this is the one place
//! a session's turns and tool calls can be traced the same way for all of
//! them, in the OpenTelemetry GenAI vocabulary an evaluation backend reads:
//!
//! - one `invoke_agent` span per prompt turn, from the `session/prompt` going
//!   out to its response coming back: the prompt as `gen_ai.input.messages`,
//!   the agent's streamed prose, reasoning and tool calls as
//!   `gen_ai.output.messages`, the stop reason as the finish reason, the
//!   turn's token usage, the tools the session's MCP servers offered as
//!   `gen_ai.tool.definitions`, the harness as the agent name and the session
//!   as the conversation id;
//! - one `execute_tool` span per tool call, from its `tool_call` to the
//!   `tool_call_update` that finishes it, with the tool's name, arguments and
//!   result read through the harness conventions `agent_fold` knows, and an
//!   error status when the call failed.
//!
//! What ACP does not carry is not invented: there is no `chat` span, because
//! the model calls happen inside the harness and never cross the wire.
//!
//! Content follows the [`ContentPolicy`] and size limits of
//! [`genai_telemetry`]; structure (names, ids, status, usage) is always
//! recorded. Everything here is best-effort and total: a frame the projector
//! cannot read changes nothing, and never the session.
//!
//! Only live frames are projected. The actor feeds this from its effect loop,
//! not from the log writer, so a reconnecting actor catching its fold up on
//! the stored log re-emits nothing.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use agent_client_protocol::schema::v1::{
    ContentBlock, EmbeddedResourceResource, InitializeRequest, InitializeResponse,
    LoadSessionRequest, NewSessionRequest, PromptRequest, PromptResponse, RequestId, Response,
    ResumeSessionRequest, SessionConfigKind, SessionConfigOption, SessionNotification,
    SessionUpdate, SetSessionConfigOptionRequest, StopReason as AcpStopReason, ToolCall,
    ToolCallUpdate, ToolKind,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage, RawJsonRpcParams};
use agent_fold::domain::harness::{ToolFrame, tool_name};
use agent_fold::domain::model::{Harness, ToolName, ToolStatus};
use agent_runtime_protocol::domain::action::MODEL_CONFIG_ID;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage};
use genai_telemetry::messages::{self, MediaSource};
use genai_telemetry::{
    ContentPolicy, GenAiSpanExt as _, attr, bound_messages, bound_tool_definitions,
    bounded_json_string,
};
use serde::Deserialize;
use serde_json::Value;

use crate::domain::model::AgentSessionId;
use crate::domain::ports::SessionToolDefinition;

use super::StopReason;

/// The tools a session's MCP servers advertise, listed once per connection by
/// a task the actor spawns and read by the projector when it records a turn.
///
/// A write-once cell rather than a channel: the listing is one fact, whoever
/// reads it wants the latest and only value, and a turn that opens before the
/// listing lands picks it up when it closes instead.
#[derive(Clone, Default)]
pub(crate) struct SharedToolDefinitions(Arc<OnceLock<Vec<SessionToolDefinition>>>);

impl SharedToolDefinitions {
    /// Publish the listing. A second publish is dropped; the first stands.
    pub(crate) fn publish(&self, definitions: Vec<SessionToolDefinition>) {
        let _ = self.0.set(definitions);
    }

    fn get(&self) -> Option<&[SessionToolDefinition]> {
        self.0.get().map(Vec::as_slice)
    }
}

/// Projects one session connection's ACP frames onto GenAI spans.
pub(crate) struct GenAiProjector {
    session: AgentSessionId,
    policy: ContentPolicy,
    /// The harness producing the frames: announced by `initialize`, or
    /// recognized from the first tool frame of a log with no `initialize`.
    harness: Harness,
    /// The model the session runs on, per the runtime's own config options.
    model: Option<String>,
    tool_definitions: SharedToolDefinitions,
    /// The `initialize` request whose response names the harness.
    initialize: Option<RequestId>,
    /// Requests whose responses carry the session's config options (and so
    /// its model): `session/new`, `session/load`, `session/resume`, and every
    /// `session/set_config_option`.
    config_requests: HashSet<RequestId>,
    /// The turn in flight, if a `session/prompt` is awaiting its answer.
    turn: Option<Turn>,
    /// Tool calls opened and not yet finished, by ACP tool call id. Under the
    /// turn in flight when there is one; a call streamed outside any turn (a
    /// resumed session whose prompt this connection never sent) gets a root
    /// span of its own.
    tools: HashMap<String, OpenTool>,
    /// The cumulative token totals the last prompt response reported, so
    /// each turn records its own share rather than the running total.
    usage_totals: Option<(u64, u64)>,
}

/// One prompt turn's span and the output it has streamed so far.
struct Turn {
    request_id: RequestId,
    span: tracing::Span,
    /// The agent's output, in order: prose, reasoning and tool calls.
    parts: Vec<OutputPart>,
    /// Facts recorded at open so they are not recorded twice at close. Each
    /// is recorded as soon as it is known, which may be at open or at close.
    agent_name_recorded: bool,
    model_recorded: bool,
    definitions_recorded: bool,
}

enum OutputPart {
    Text(String),
    Reasoning(String),
    ToolCall {
        id: String,
        name: String,
        arguments: Value,
    },
}

impl OutputPart {
    fn into_json(self) -> Value {
        match self {
            Self::Text(text) => messages::text_part(text),
            Self::Reasoning(text) => messages::reasoning_part(text),
            Self::ToolCall {
                id,
                name,
                arguments,
            } => messages::tool_call_part(Some(&id), &name, arguments),
        }
    }
}

/// One tool call's span and what its frames have said so far.
struct OpenTool {
    span: tracing::Span,
    name: ToolName,
    status: ToolStatus,
    /// The latest `rawInput` seen: a harness may stream the arguments over
    /// several patches, and the last complete value is the call's.
    arguments: Option<Value>,
    /// Index of this call's part in the turn's output, when it has one.
    part: Option<usize>,
}

/// How a turn ended.
enum Outcome<'outcome> {
    /// The runtime answered the prompt; the result carries the stop reason.
    Answered(&'outcome Value),
    /// The runtime refused the prompt with a JSON-RPC error.
    Refused(&'outcome str),
    /// Another prompt went out before this one was answered.
    Superseded,
    /// The connection ended with the turn in flight.
    Stopped(&'outcome StopReason),
}

impl GenAiProjector {
    /// A projector for `session`, recording content under `policy` and tool
    /// definitions from `tool_definitions` once they are published.
    pub(crate) fn new(
        session: AgentSessionId,
        policy: ContentPolicy,
        tool_definitions: SharedToolDefinitions,
    ) -> Self {
        Self {
            session,
            policy,
            harness: Harness::Unknown,
            model: None,
            tool_definitions,
            initialize: None,
            config_requests: HashSet::new(),
            turn: None,
            tools: HashMap::new(),
            usage_totals: None,
        }
    }

    /// The cell the connection's tool listing is published into.
    pub(crate) fn tool_definitions(&self) -> SharedToolDefinitions {
        self.tool_definitions.clone()
    }

    /// A frame this side is sending to the runtime. A `session/prompt` opens a
    /// turn, as a child of `parent` - the span of the command that carried
    /// the prompt - when there is one.
    pub(crate) fn on_outbound(
        &mut self,
        message: &ToRuntimeMessage,
        parent: Option<&tracing::Span>,
    ) {
        let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = message else {
            return;
        };
        let method = &request.method;
        if InitializeRequest::matches_method(method) {
            self.initialize = Some(request.id.clone());
        } else if NewSessionRequest::matches_method(method)
            || LoadSessionRequest::matches_method(method)
            || ResumeSessionRequest::matches_method(method)
            || SetSessionConfigOptionRequest::matches_method(method)
        {
            self.config_requests.insert(request.id.clone());
        } else if PromptRequest::matches_method(method) {
            let prompt: Option<PromptRequest> = deserialize_params(request.params.as_ref());
            self.begin_turn(request.id.clone(), prompt, parent);
        }
    }

    /// A frame the runtime sent.
    pub(crate) fn on_inbound(&mut self, message: &ToServerMessage) {
        let ToServerMessage::Acp(AcpMessage(frame)) = message else {
            return;
        };
        match frame {
            RawJsonRpcMessage::Response(Response::Result { id, result }) => {
                self.on_result(id, result);
            }
            RawJsonRpcMessage::Response(Response::Error { id, error }) => {
                if self
                    .turn
                    .as_ref()
                    .is_some_and(|turn| &turn.request_id == id)
                    && let Some(turn) = self.turn.take()
                {
                    self.end_turn(turn, Outcome::Refused(&error.message));
                }
            }
            RawJsonRpcMessage::Notification(notification)
                if SessionNotification::matches_method(&notification.method) =>
            {
                if let Some(notification) =
                    deserialize_params::<SessionNotification>(notification.params.as_ref())
                {
                    self.on_update(notification.update);
                }
            }
            RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => {}
        }
    }

    /// The connection is over. A turn in flight ends in error; tool calls
    /// still open are marked abandoned.
    pub(crate) fn on_stopped(&mut self, reason: &StopReason) {
        if let Some(turn) = self.turn.take() {
            self.end_turn(turn, Outcome::Stopped(reason));
        }
        for (_, tool) in self.tools.drain() {
            tool.span.set_error("session_stopped", reason.to_string());
        }
    }

    fn on_result(&mut self, id: &RequestId, result: &Value) {
        if self.initialize.as_ref() == Some(id) {
            self.initialize = None;
            if let Ok(response) = serde_json::from_value::<InitializeResponse>(result.clone())
                && let Some(info) = response.agent_info
            {
                self.harness = Harness::from_agent_info(&info.name);
            }
            return;
        }
        if self.config_requests.remove(id) {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct ConfigCarrier {
                #[serde(default)]
                config_options: Vec<SessionConfigOption>,
            }
            if let Ok(carrier) = serde_json::from_value::<ConfigCarrier>(result.clone()) {
                self.apply_config_options(carrier.config_options);
            }
            return;
        }
        if self
            .turn
            .as_ref()
            .is_some_and(|turn| &turn.request_id == id)
            && let Some(turn) = self.turn.take()
        {
            self.end_turn(turn, Outcome::Answered(result));
        }
    }

    fn on_update(&mut self, update: SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => self.append_output(&chunk.content, false),
            SessionUpdate::AgentThoughtChunk(chunk) => self.append_output(&chunk.content, true),
            SessionUpdate::ToolCall(call) => self.open_tool(call),
            SessionUpdate::ToolCallUpdate(update) => self.patch_tool(update),
            SessionUpdate::ConfigOptionUpdate(update) => {
                self.apply_config_options(update.config_options);
            }
            SessionUpdate::UsageUpdate(usage) => {
                if let Some(turn) = &self.turn {
                    turn.span
                        .set_u64(attr::MACRO_CONTEXT_USED_TOKENS, usage.used);
                    turn.span
                        .set_u64(attr::MACRO_CONTEXT_SIZE_TOKENS, usage.size);
                }
            }
            // Plans, modes, commands, titles and the user's own echoed
            // chunks: nothing a judge of the turn needs.
            _ => {}
        }
    }

    fn apply_config_options(&mut self, options: Vec<SessionConfigOption>) {
        let model = options
            .into_iter()
            .find(|option| option.id.to_string() == MODEL_CONFIG_ID);
        if let Some(SessionConfigOption {
            kind: SessionConfigKind::Select(select),
            ..
        }) = model
        {
            self.model = Some(select.current_value.to_string());
        }
    }

    fn begin_turn(
        &mut self,
        request_id: RequestId,
        prompt: Option<PromptRequest>,
        parent: Option<&tracing::Span>,
    ) {
        if let Some(previous) = self.turn.take() {
            self.end_turn(previous, Outcome::Superseded);
        }
        // The literal stays in step with `attr::span_name::INVOKE_AGENT`;
        // `tracing` bakes the name into static metadata.
        let span = match parent {
            Some(parent) => tracing::info_span!(
                parent: parent,
                "invoke_agent",
                gen_ai.operation.name = attr::operation::INVOKE_AGENT,
                gen_ai.conversation.id = %self.session,
                agent.session.id = %self.session,
            ),
            None => tracing::info_span!(
                "invoke_agent",
                gen_ai.operation.name = attr::operation::INVOKE_AGENT,
                gen_ai.conversation.id = %self.session,
                agent.session.id = %self.session,
            ),
        };
        let mut turn = Turn {
            request_id,
            span,
            parts: Vec::new(),
            agent_name_recorded: false,
            model_recorded: false,
            definitions_recorded: false,
        };
        self.record_turn_facts(&mut turn);
        if self.policy.capture
            && let Some(prompt) = prompt
        {
            let parts: Vec<Value> = prompt.prompt.iter().filter_map(prompt_part).collect();
            let bounded = bound_messages(
                vec![messages::message(messages::ROLE_USER, parts)],
                &self.policy.limits,
            );
            turn.span.set_str(attr::INPUT_MESSAGES, bounded.json);
            if bounded.truncated {
                turn.span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
            }
        }
        self.turn = Some(turn);
    }

    /// Record what is known about the session onto a turn's span: the
    /// harness, the model and the offered tools, each once, as soon as known.
    fn record_turn_facts(&self, turn: &mut Turn) {
        if !turn.agent_name_recorded && self.harness != Harness::Unknown {
            turn.span
                .set_str(attr::AGENT_NAME, harness_name(self.harness));
            turn.agent_name_recorded = true;
        }
        if !turn.model_recorded
            && let Some(model) = &self.model
        {
            turn.span.set_str(attr::REQUEST_MODEL, model.clone());
            turn.model_recorded = true;
        }
        if !turn.definitions_recorded
            && let Some(definitions) = self.tool_definitions.get()
        {
            turn.definitions_recorded = true;
            if !definitions.is_empty() {
                let definitions = definitions
                    .iter()
                    .map(|definition| {
                        messages::tool_definition(
                            &self.definition_name(&definition.name),
                            &definition.description,
                            definition.parameters.clone(),
                        )
                    })
                    .collect();
                let (json, truncated) = bound_tool_definitions(definitions, &self.policy.limits);
                turn.span.set_str(attr::TOOL_DEFINITIONS, json);
                if truncated {
                    turn.span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
                }
            }
        }
    }

    /// A listed tool's name as this harness calls it. Macro's in-process agent
    /// calls Macro's tools natively, by their bare names, while the listing
    /// sees them through Macro's MCP server as `mcp__macro__<tool>`; every
    /// other harness calls them by the listed name.
    fn definition_name(&self, listed: &str) -> String {
        let name: ToolName = listed.parse().unwrap_or_else(|never| match never {});
        if self.harness == Harness::Macro
            && let ToolName::Mcp { .. } = &name
            && let Some(tool) = self.harness.reader().macro_tool(&name)
        {
            return tool.to_owned();
        }
        listed.to_owned()
    }

    /// The listed description of the tool behind `name`, if it was listed.
    fn tool_description(&self, name: &ToolName) -> Option<String> {
        let display = name.display();
        let mangled = match name {
            ToolName::Mcp { server, tool } => Some(format!("mcp__{server}__{tool}")),
            ToolName::Native { .. } => None,
        };
        self.tool_definitions.get()?.iter().find_map(|definition| {
            (definition.name == display
                || mangled.as_deref() == Some(definition.name.as_str())
                || self.definition_name(&definition.name) == display)
                .then(|| definition.description.clone())
        })
    }

    fn end_turn(&mut self, mut turn: Turn, outcome: Outcome<'_>) {
        let finish_reason = match outcome {
            Outcome::Answered(result) => {
                self.record_usage(&turn.span, result);
                let stop_reason = serde_json::from_value::<PromptResponse>(result.clone())
                    .ok()
                    .map(|response| response.stop_reason);
                finish_reason(stop_reason)
            }
            Outcome::Refused(message) => {
                turn.span.set_error("prompt_refused", message);
                attr::finish_reason::ERROR
            }
            Outcome::Superseded => {
                turn.span.set_error(
                    "superseded",
                    "another prompt was sent before this turn was answered",
                );
                attr::finish_reason::ERROR
            }
            Outcome::Stopped(reason) => {
                turn.span.set_error("session_stopped", reason.to_string());
                attr::finish_reason::ERROR
            }
        };

        // A call the turn ended on is over for the judge's purposes, whatever
        // the harness would have said next: mark it rather than leak its span.
        let abandoned = if finish_reason == attr::finish_reason::CANCELLED {
            "the turn was cancelled before the tool call finished"
        } else {
            "the turn ended before the tool call finished"
        };
        for (_, tool) in self.tools.drain() {
            tool.span.set_error("abandoned", abandoned);
        }

        self.record_turn_facts(&mut turn);
        if !turn.agent_name_recorded {
            turn.span
                .set_str(attr::AGENT_NAME, harness_name(self.harness));
        }
        turn.span
            .set_str_array(attr::RESPONSE_FINISH_REASONS, [finish_reason]);
        if self.policy.capture {
            let parts = turn.parts.into_iter().map(OutputPart::into_json).collect();
            let bounded = bound_messages(
                vec![messages::output_message(
                    messages::ROLE_ASSISTANT,
                    parts,
                    finish_reason,
                )],
                &self.policy.limits,
            );
            turn.span.set_str(attr::OUTPUT_MESSAGES, bounded.json);
            if bounded.truncated {
                turn.span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
            }
        }
        // Dropping the last handle closes the span.
    }

    /// The turn's token usage from the prompt response. ACP reports running
    /// session totals, so each turn records the increase over the previous
    /// response; the first response a connection sees records the total,
    /// which for a resumed session includes earlier turns.
    fn record_usage(&mut self, span: &tracing::Span, result: &Value) {
        let input = result.pointer("/usage/inputTokens").and_then(Value::as_u64);
        let output = result
            .pointer("/usage/outputTokens")
            .and_then(Value::as_u64);
        let (Some(input), Some(output)) = (input, output) else {
            return;
        };
        let (turn_input, turn_output) = match self.usage_totals {
            Some((previous_input, previous_output))
                if input >= previous_input && output >= previous_output =>
            {
                (input - previous_input, output - previous_output)
            }
            _ => (input, output),
        };
        self.usage_totals = Some((input, output));
        span.set_u64(attr::USAGE_INPUT_TOKENS, turn_input);
        span.set_u64(attr::USAGE_OUTPUT_TOKENS, turn_output);
    }

    fn append_output(&mut self, content: &ContentBlock, reasoning: bool) {
        let ContentBlock::Text(text) = content else {
            return;
        };
        let Some(turn) = &mut self.turn else {
            return;
        };
        match (turn.parts.last_mut(), reasoning) {
            (Some(OutputPart::Text(existing)), false)
            | (Some(OutputPart::Reasoning(existing)), true) => existing.push_str(&text.text),
            (_, false) => turn.parts.push(OutputPart::Text(text.text.clone())),
            (_, true) => turn.parts.push(OutputPart::Reasoning(text.text.clone())),
        }
    }

    fn open_tool(&mut self, call: ToolCall) {
        let frame = ToolFrame::of_call(&call);
        self.sniff_harness(&frame);
        let reader = self.harness.reader();
        let name = tool_name(reader, &frame);
        let id = call.tool_call_id.0.to_string();
        let tool_display = name.display().to_owned();

        // The literal stays in step with `attr::span_name::EXECUTE_TOOL`;
        // `otel.name` gives the exported span the semconv `execute_tool
        // {name}` name.
        let otel_name = format!("{} {tool_display}", attr::operation::EXECUTE_TOOL);
        let span = match &self.turn {
            Some(turn) => tracing::info_span!(
                parent: &turn.span,
                "execute_tool",
                otel.name = %otel_name,
                gen_ai.operation.name = attr::operation::EXECUTE_TOOL,
                gen_ai.tool.type = attr::tool_type::FUNCTION,
                gen_ai.tool.name = %tool_display,
                gen_ai.tool.call.id = %id,
                gen_ai.conversation.id = %self.session,
                agent.session.id = %self.session,
            ),
            None => tracing::info_span!(
                "execute_tool",
                otel.name = %otel_name,
                gen_ai.operation.name = attr::operation::EXECUTE_TOOL,
                gen_ai.tool.type = attr::tool_type::FUNCTION,
                gen_ai.tool.name = %tool_display,
                gen_ai.tool.call.id = %id,
                gen_ai.conversation.id = %self.session,
                agent.session.id = %self.session,
            ),
        };
        span.set_str(attr::MACRO_TOOL_KIND, tool_kind_name(call.kind));
        if !call.title.is_empty() {
            span.set_str(attr::MACRO_TOOL_TITLE, call.title.clone());
        }
        if let ToolName::Mcp { server, .. } = &name {
            span.set_str(attr::MACRO_MCP_SERVER, server.clone());
        }
        if let Some(description) = self.tool_description(&name) {
            span.set_str(attr::TOOL_DESCRIPTION, description);
        }

        let arguments = call.raw_input.clone().filter(|input| !input.is_null());
        let part = self.turn.as_mut().map(|turn| {
            turn.parts.push(OutputPart::ToolCall {
                id: id.clone(),
                name: tool_display,
                arguments: arguments.clone().unwrap_or(Value::Null),
            });
            turn.parts.len() - 1
        });
        let status = frame.status.unwrap_or_default();
        if let Some(replaced) = self.tools.insert(
            id.clone(),
            OpenTool {
                span,
                name,
                status,
                arguments,
                part,
            },
        ) {
            replaced
                .span
                .set_error("superseded", "the harness reopened this tool call id");
        }
        if status.is_finished() {
            self.finish_tool(&id, &frame);
        }
    }

    fn patch_tool(&mut self, update: ToolCallUpdate) {
        let id = update.tool_call_id.0.to_string();
        let mut frame = ToolFrame::of_update(&update);
        self.sniff_harness(&frame);
        let Some(tool) = self.tools.get_mut(&id) else {
            // A call this connection never saw open: a resumed session
            // mid-call. Nothing to attach it to.
            return;
        };
        if frame.status.is_none() {
            frame = frame.with_status(tool.status);
        }
        if let Some(status) = frame.status {
            tool.status = status;
        }
        if let Some(input) = frame.raw_input
            && !input.is_null()
        {
            tool.arguments = Some(input.clone());
        }
        // A harness may name the tool only once it knows what it is running.
        if tool.name.is_empty() {
            let named = tool_name(self.harness.reader(), &frame);
            if !named.is_empty() {
                let display = named.display().to_owned();
                tool.span.record("gen_ai.tool.name", display.as_str());
                tool.span.record(
                    "otel.name",
                    format!("{} {display}", attr::operation::EXECUTE_TOOL).as_str(),
                );
                tool.name = named;
            }
        }
        if frame.finished() {
            self.finish_tool(&id, &frame);
        }
    }

    fn finish_tool(&mut self, id: &str, frame: &ToolFrame<'_>) {
        let Some(tool) = self.tools.remove(id) else {
            return;
        };
        let reader = self.harness.reader();
        let (result, mut error) = match frame.raw_output {
            Some(raw) => {
                let (value, error) = reader.unwrap_tool_output(raw);
                (Some(value), error)
            }
            None => (
                frame
                    .content_text()
                    .or_else(|| reader.terminal_output(frame))
                    .map(Value::String),
                None,
            ),
        };
        if error.is_none()
            && let Some(code) = reader.terminal_exit_code(frame)
            && code != 0
        {
            error = Some(format!("the command exited with code {code}"));
        }

        if self.policy.capture {
            if let Some(arguments) = &tool.arguments {
                let (json, truncated) = bounded_json_string(arguments, &self.policy.limits);
                tool.span.set_str(attr::TOOL_CALL_ARGUMENTS, json);
                if truncated {
                    tool.span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
                }
            }
            if let Some(result) = &result {
                let (json, truncated) = bounded_json_string(result, &self.policy.limits);
                tool.span.set_str(attr::TOOL_CALL_RESULT, json);
                if truncated {
                    tool.span.set_bool(attr::MACRO_CONTENT_TRUNCATED, true);
                }
            }
        }
        match (tool.status, error) {
            (ToolStatus::Failed, error) => tool.span.set_error(
                "tool_error",
                error.unwrap_or_else(|| "the tool call failed".to_owned()),
            ),
            (_, Some(error)) => tool.span.set_error("tool_error", error),
            (_, None) => {}
        }

        // The turn's record of the call gets the final arguments and name.
        if let (Some(turn), Some(index)) = (&mut self.turn, tool.part)
            && let Some(OutputPart::ToolCall {
                name, arguments, ..
            }) = turn.parts.get_mut(index)
        {
            if let Some(final_arguments) = tool.arguments {
                *arguments = final_arguments;
            }
            if name.is_empty() {
                *name = tool.name.display().to_owned();
            }
        }
        // Dropping the last handle closes the span.
    }

    /// Recognize the harness from a tool frame when no `initialize` named it.
    fn sniff_harness(&mut self, frame: &ToolFrame<'_>) {
        if self.harness == Harness::Unknown
            && let Some(harness) = Harness::sniff(frame)
        {
            self.harness = harness;
        }
    }
}

/// Deserialize a request's or notification's params as a specific ACP type.
/// `None` for positional params or a shape mismatch: less is derived from the
/// frame, nothing fails.
fn deserialize_params<T: serde::de::DeserializeOwned>(
    params: Option<&RawJsonRpcParams>,
) -> Option<T> {
    match params? {
        RawJsonRpcParams::Object(map) => serde_json::from_value(Value::Object(map.clone())).ok(),
        RawJsonRpcParams::Array(_) => None,
    }
}

/// A prompt content block as a semconv message part. Inline bytes are never
/// copied onto a span; a resource is named by its URI.
fn prompt_part(block: &ContentBlock) -> Option<Value> {
    Some(match block {
        ContentBlock::Text(text) => messages::text_part(text.text.clone()),
        ContentBlock::Image(image) => messages::media_part(
            "image",
            Some(&image.mime_type),
            image
                .uri
                .clone()
                .map_or(MediaSource::Inline, MediaSource::Uri),
        ),
        ContentBlock::Audio(audio) => {
            messages::media_part("audio", Some(&audio.mime_type), MediaSource::Inline)
        }
        ContentBlock::ResourceLink(link) => {
            messages::text_part(format!("[resource {}] {}", link.name, link.uri))
        }
        ContentBlock::Resource(embedded) => match &embedded.resource {
            EmbeddedResourceResource::TextResourceContents(text) => {
                messages::text_part(format!("[resource {}]\n{}", text.uri, text.text))
            }
            EmbeddedResourceResource::BlobResourceContents(blob) => messages::media_part(
                "document",
                blob.mime_type.as_deref(),
                MediaSource::Uri(blob.uri.clone()),
            ),
            // `#[non_exhaustive]`: a resource shape this build does not know.
            _ => return None,
        },
        // `#[non_exhaustive]`: a block this build does not know.
        _ => return None,
    })
}

/// The semconv finish reason for how a turn stopped.
fn finish_reason(stop_reason: Option<AcpStopReason>) -> &'static str {
    match stop_reason {
        Some(AcpStopReason::EndTurn) => attr::finish_reason::STOP,
        Some(AcpStopReason::MaxTokens | AcpStopReason::MaxTurnRequests) => {
            attr::finish_reason::LENGTH
        }
        Some(AcpStopReason::Refusal) => attr::finish_reason::CONTENT_FILTER,
        Some(AcpStopReason::Cancelled) => attr::finish_reason::CANCELLED,
        // `#[non_exhaustive]`, and a response this build cannot read: the
        // turn was answered, which is all that is known.
        Some(_) | None => attr::finish_reason::STOP,
    }
}

/// The harness as the agent name spans carry, in the fold's own snake_case
/// spelling so it matches the `harness` field a session's readers show.
fn harness_name(harness: Harness) -> String {
    serde_json::to_value(harness)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

/// ACP's coarse tool kind, in its wire spelling.
fn tool_kind_name(kind: ToolKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}
