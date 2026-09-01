//! The agent side of ACP, served over an in-process channel.
//!
//! One agent task serves one Macro session ([`RuntimeAttachment::solo`] on
//! the harness side), so the surface is small: `initialize`, `session/new`
//! or `session/resume`, `session/prompt`, `session/set_config_option`, and
//! `session/cancel`. Prompts run through the [`TurnEngine`] and stream back
//! as `session/update` notifications the existing fold and UI already render.
//!
//! [`RuntimeAttachment::solo`]: agent_session::domain::connection::RuntimeAttachment::solo

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent::types::{AssistantMessagePart, ChatMessage};
use agent::{StreamAccumulator, StreamPart, ToolResponse};
use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, ContentBlock, ContentChunk, InitializeRequest,
    InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
    ResumeSessionRequest, ResumeSessionResponse, SessionCapabilities, SessionId,
    SessionNotification, SessionResumeCapabilities, SessionUpdate, SetSessionConfigOptionRequest,
    SetSessionConfigOptionResponse, StopReason, ToolCall as AcpToolCall, ToolCallStatus,
    ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use agent_client_protocol::{
    Agent, Channel as AcpChannel, Client, ConnectionTo, Error as AcpError,
};
use agent_runtime_protocol::domain::action::{COMPACT_COMMAND, MODEL_CONFIG_ID};
use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;

use crate::domain::engine::{TurnEngine, TurnRequest};
use crate::domain::session::{HistoryEntry, SessionStore, messages_for_turn};

#[cfg(test)]
mod test;

/// A turn that produces nothing for this long is treated as hung and
/// cancelled, so it cannot wedge the session's turn lock forever.
const TURN_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// What one turn reads out of its session's state before running.
struct TurnInput {
    /// The conversation so far plus the prompt being answered.
    messages: Vec<ChatMessage>,
    /// Model the turn runs on.
    model: String,
    /// The session's instructions, for the engine's system prompt.
    instructions: Option<String>,
}

/// Everything one agent task serves its session from.
pub struct AgentState {
    /// The Macro session this agent runs.
    pub session_id: AgentSessionId,
    /// The session's owner; turns run on their behalf.
    pub owner: MacroUserIdStr<'static>,
    /// Runs the actual turns.
    pub engine: Arc<dyn TurnEngine>,
    /// Conversation state, shared with the manager so it survives reattach.
    pub store: Arc<SessionStore>,
    /// Every outstanding turn's cancellation token - the running turn and any
    /// queued behind it. `session/cancel` stops them all.
    pub active_cancel: Mutex<Vec<CancellationToken>>,
    /// Serializes turns: the client may queue prompts, the engine runs one at
    /// a time.
    pub turn_lock: tokio::sync::Mutex<()>,
}

impl AgentState {
    fn expect_session(&self, requested: &SessionId) -> Result<(), AcpError> {
        let matches = self
            .store
            .get(&self.session_id)
            .is_some_and(|state| state.acp_session_id.as_ref() == Some(requested));
        if matches {
            Ok(())
        } else {
            Err(AcpError::invalid_params().data(format!("unknown session {requested}")))
        }
    }

    /// Bind `acp_id` as this session's ACP session, keeping the recorded
    /// conversation only when it already belongs to that id.
    fn bind_acp_session(&self, acp_id: SessionId, keep_history: bool) {
        if let Some(mut state) = self.store.get_mut(&self.session_id) {
            if !keep_history || state.acp_session_id.as_ref() != Some(&acp_id) {
                state.history.clear();
            }
            state.acp_session_id = Some(acp_id);
        }
    }

    fn clear_history(&self) {
        if let Some(mut state) = self.store.get_mut(&self.session_id) {
            state.history.clear();
        }
    }

    fn set_model(&self, model: String) {
        if let Some(mut state) = self.store.get_mut(&self.session_id) {
            state.model = model;
        }
    }

    /// Everything from the session's state that a turn answering `prompt`
    /// runs from.
    fn turn_input(&self, prompt: &str) -> TurnInput {
        self.store.get(&self.session_id).map_or_else(
            || TurnInput {
                messages: messages_for_turn(&[], prompt),
                model: String::new(),
                instructions: None,
            },
            |state| TurnInput {
                messages: messages_for_turn(&state.history, prompt),
                model: state.model.clone(),
                instructions: state.instructions.clone(),
            },
        )
    }

    fn push_turn(&self, prompt: String, parts: Vec<AssistantMessagePart>) {
        if let Some(mut state) = self.store.get_mut(&self.session_id) {
            state.history.push(HistoryEntry::User(prompt));
            if !parts.is_empty() {
                state.history.push(HistoryEntry::Assistant(parts));
            }
        }
    }

    fn begin_turn(&self) -> CancellationToken {
        let cancel = CancellationToken::new();
        let mut outstanding = self
            .active_cancel
            .lock()
            .expect("active turn lock should not be poisoned");
        outstanding.retain(|token| !token.is_cancelled());
        outstanding.push(cancel.clone());
        cancel
    }

    fn cancel_active_turns(&self) {
        for cancel in self
            .active_cancel
            .lock()
            .expect("active turn lock should not be poisoned")
            .iter()
        {
            cancel.cancel();
        }
    }
}

/// Serve this session's agent on `acp` until the connection closes.
pub async fn serve(state: Arc<AgentState>, acp: AcpChannel) -> Result<(), AcpError> {
    Agent
        .builder()
        .name("macro-inmem")
        .on_receive_request(
            async move |request: InitializeRequest, responder, _connection| {
                responder.respond(
                    InitializeResponse::new(request.protocol_version).agent_capabilities(
                        AgentCapabilities::new().session_capabilities(
                            SessionCapabilities::new().resume(SessionResumeCapabilities::new()),
                        ),
                    ),
                )
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = Arc::clone(&state);
                async move |_request: NewSessionRequest, responder, _connection| {
                    let state = Arc::clone(&state);
                    let acp_id = SessionId::new(macro_uuid::generate_uuid_v7().to_string());
                    state.bind_acp_session(acp_id.clone(), false);
                    responder.respond(NewSessionResponse::new(acp_id))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = Arc::clone(&state);
                async move |request: ResumeSessionRequest, responder, _connection| {
                    let state = Arc::clone(&state);
                    // Kept when the state already belongs to this ACP id -
                    // either this process served the session, or a cold
                    // attach replayed the frame log back into it (see
                    // `domain::replay`).
                    state.bind_acp_session(request.session_id, true);
                    responder.respond(ResumeSessionResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = Arc::clone(&state);
                async move |request: PromptRequest, responder, connection| {
                    let state = Arc::clone(&state);
                    if let Err(error) = state.expect_session(&request.session_id) {
                        return responder.respond_with_error(error);
                    }
                    let prompt = prompt_text(&request);
                    if prompt.trim() == COMPACT_COMMAND {
                        state.clear_history();
                        let _ = connection.send_notification(SessionNotification::new(
                            request.session_id,
                            SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                "Compacted: the earlier conversation is no longer in the \
                                 model's context."
                                    .into(),
                            )),
                        ));
                        return responder.respond(PromptResponse::new(StopReason::EndTurn));
                    }

                    let cancel = state.begin_turn();
                    connection.spawn({
                        let connection = connection.clone();
                        async move {
                            let stop =
                                run_turn(&state, &connection, request.session_id, prompt, cancel)
                                    .await;
                            // A closed connection is the only way this fails,
                            // and failing the spawned task would tear the
                            // whole (already closing) server down.
                            let _ = responder.respond(PromptResponse::new(stop));
                            Ok(())
                        }
                    })?;
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                let state = Arc::clone(&state);
                async move |request: SetSessionConfigOptionRequest, responder, _connection| {
                    let state = Arc::clone(&state);
                    if let Err(error) = state.expect_session(&request.session_id) {
                        return responder.respond_with_error(error);
                    }
                    if request.config_id.to_string() != MODEL_CONFIG_ID {
                        return responder.respond_with_error(
                            AcpError::invalid_params()
                                .data(format!("unknown config option {}", request.config_id)),
                        );
                    }
                    let Some(model) = request.value.as_value_id() else {
                        return responder.respond_with_error(
                            AcpError::invalid_params().data("the model option takes a value id"),
                        );
                    };
                    state.set_model(model.to_string());
                    responder.respond(SetSessionConfigOptionResponse::new(Vec::new()))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            {
                let state = Arc::clone(&state);
                async move |notification: CancelNotification, _connection| {
                    let state = Arc::clone(&state);
                    if state.expect_session(&notification.session_id).is_ok() {
                        state.cancel_active_turns();
                    }
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_to(acp)
        .await
}

/// Run one turn to completion, streaming updates as they arrive.
async fn run_turn(
    state: &AgentState,
    connection: &ConnectionTo<Client>,
    acp_session_id: SessionId,
    prompt: String,
    cancel: CancellationToken,
) -> StopReason {
    let _turn = state.turn_lock.lock().await;
    let TurnInput {
        messages,
        model,
        instructions,
    } = state.turn_input(&prompt);
    let mut parts = state.engine.run_turn(TurnRequest {
        owner: state.owner.clone(),
        model,
        instructions,
        messages,
        cancel: cancel.clone(),
    });

    let mut accumulator = StreamAccumulator::new();
    let mut failure = None;
    loop {
        match tokio::time::timeout(TURN_IDLE_TIMEOUT, parts.recv()).await {
            Ok(Some(Ok(part))) => {
                if let Some(update) = update_for_part(&part) {
                    let notification = SessionNotification::new(acp_session_id.clone(), update);
                    if connection.send_notification(notification).is_err() {
                        // Nobody is listening; stop spending tokens.
                        cancel.cancel();
                        break;
                    }
                }
                accumulator.push(part);
            }
            Ok(Some(Err(error))) => {
                failure = Some(error.to_string());
                break;
            }
            Ok(None) => break,
            Err(_) => {
                failure = Some(format!(
                    "the turn produced nothing for {} seconds and was stopped",
                    TURN_IDLE_TIMEOUT.as_secs()
                ));
                cancel.cancel();
                break;
            }
        }
    }

    let mut turn_parts = accumulator.into_parts();
    for (id, _name) in close_dangling_tool_calls(&mut turn_parts) {
        let _ = connection.send_notification(SessionNotification::new(
            acp_session_id.clone(),
            SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                id,
                ToolCallUpdateFields::new().status(ToolCallStatus::Failed),
            )),
        ));
    }
    if let Some(failure) = failure {
        let _ = connection.send_notification(SessionNotification::new(
            acp_session_id.clone(),
            SessionUpdate::AgentMessageChunk(ContentChunk::new(
                format!("The agent stopped on an error: {failure}").into(),
            )),
        ));
    }
    state.push_turn(prompt, turn_parts);

    if cancel.is_cancelled() {
        StopReason::Cancelled
    } else {
        StopReason::EndTurn
    }
}

/// The `session/update` a stream part renders as, if any.
fn update_for_part(part: &StreamPart) -> Option<SessionUpdate> {
    match part {
        StreamPart::Content(text) => Some(SessionUpdate::AgentMessageChunk(ContentChunk::new(
            ContentBlock::from(text.clone()),
        ))),
        StreamPart::Thinking(text) => Some(SessionUpdate::AgentThoughtChunk(ContentChunk::new(
            ContentBlock::from(text.clone()),
        ))),
        StreamPart::ToolCall(call) => {
            let title = call
                .mcp
                .as_ref()
                .and_then(|mcp| mcp.display_name.clone())
                .unwrap_or_else(|| call.name.clone());
            Some(SessionUpdate::ToolCall(
                AcpToolCall::new(call.id.clone(), title)
                    .kind(tool_kind(&call.name))
                    .status(ToolCallStatus::InProgress)
                    .raw_input(call.json.clone()),
            ))
        }
        StreamPart::ToolResponse(ToolResponse::Json { id, json, .. }) => {
            Some(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                id.clone(),
                ToolCallUpdateFields::new()
                    .status(ToolCallStatus::Completed)
                    .raw_output(json.clone()),
            )))
        }
        StreamPart::ToolResponse(ToolResponse::Err {
            id, description, ..
        }) => Some(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            id.clone(),
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Failed)
                .raw_output(serde_json::json!({ "error": description })),
        ))),
        // Recorded by the loop's usage recorder; nothing to render.
        StreamPart::Usage(_) => None,
    }
}

/// A coarse [`ToolKind`] for a Macro tool name, for client iconography only.
fn tool_kind(name: &str) -> ToolKind {
    let name = name.to_ascii_lowercase();
    if name.contains("search") {
        ToolKind::Search
    } else if name.starts_with("read") || name.starts_with("get") || name.starts_with("list") {
        ToolKind::Read
    } else if name.starts_with("delete") {
        ToolKind::Delete
    } else if name.starts_with("create")
        || name.starts_with("edit")
        || name.starts_with("update")
        || name.starts_with("rename")
        || name.starts_with("set")
    {
        ToolKind::Edit
    } else {
        ToolKind::Other
    }
}

/// The prompt's text content, other block types ignored.
fn prompt_text(request: &PromptRequest) -> String {
    request
        .prompt
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect()
}

/// Close tool calls that never got a response - a cancelled or failed turn
/// leaves them dangling, and an unmatched call would poison the next turn's
/// provider payload. Returns what was synthesized as `(id, name)`.
pub(crate) fn close_dangling_tool_calls(
    parts: &mut Vec<AssistantMessagePart>,
) -> Vec<(String, String)> {
    let responded: HashSet<String> = parts
        .iter()
        .filter_map(|part| match part {
            AssistantMessagePart::ToolCallResponseJson { id, .. }
            | AssistantMessagePart::ToolCallErr { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect();
    let dangling: Vec<(String, String)> = parts
        .iter()
        .filter_map(|part| match part {
            AssistantMessagePart::ToolCall { id, name, .. }
            | AssistantMessagePart::McpToolCall { id, name, .. }
                if !responded.contains(id) =>
            {
                Some((id.clone(), name.clone()))
            }
            _ => None,
        })
        .collect();
    for (id, name) in &dangling {
        parts.push(AssistantMessagePart::ToolCallErr {
            name: name.clone(),
            description: "cancelled".to_owned(),
            id: id.clone(),
        });
    }
    dangling
}
