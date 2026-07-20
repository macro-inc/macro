//! The agent proxy domain service.

#[cfg(test)]
mod test;

use crate::domain::models::{
    AgentProxyErr, CreateAgentArgs, GetAgentResponse, PatchAgentArgs, Result,
};
use crate::domain::ports::{ClientNotifier, RuntimeProvisioner, RuntimeSessions};
use crate::domain::translate::{TurnAccumulator, content_blocks_text, translate_session_update};
use agent::types::{ChatMessageContent, Role};
use agent_client_protocol::JsonRpcMessage;
use agent_client_protocol::schema::v1::{PromptRequest, SessionNotification};
use agent_client_protocol::{RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use chat::domain::models::{ChatAgentKind, ChatStream, CreateChatArgs, PatchChatArgs};
use chat::domain::ports::{ChatRepo, MessageRepo};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7, string_to_uuid};
use model::chat::NewChatMessage;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use stream::domain::{StreamId, StreamRepo};
use unicode_segmentation::UnicodeSegmentation;

/// Model string recorded on messages persisted for external agent sessions.
pub const EXTERNAL_AGENT_MODEL: &str = "external";

/// Gateway message type for agent runtime lifecycle events.
pub const AGENT_SYSTEM_EVENT_MESSAGE_TYPE: &str = "agent_system_event";

/// Service trait for the agent proxy use cases.
///
/// Handlers and the runtime listener depend on this trait rather than the
/// concrete implementation.
pub trait AgentProxyService: Send + Sync + 'static {
    /// Create a new agent chat entity owned by `user_id`.
    fn create_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateAgentArgs,
    ) -> impl Future<Output = Result<Uuid>> + Send;

    /// Get an agent with its full chat data.
    fn get_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> impl Future<Output = Result<GetAgentResponse>> + Send;

    /// Patch an agent's metadata. Requires edit access.
    fn patch_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
        args: PatchAgentArgs,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Soft-delete an agent. Requires owner access.
    fn delete_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Permanently delete an agent. Requires owner access.
    fn permanently_delete_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Provision a fresh dial-in endpoint for an external agent's runtime.
    /// Requires edit access.
    fn provision_runtime_connection(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> impl Future<Output = Result<String>> + Send;

    /// Forward one user-posted ACP message to the runtime hosting the
    /// session, persisting prompts as user chat messages.
    fn post_acp(
        &self,
        user_id: MacroUserIdStr<'static>,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Handle one ACP message received from an agent runtime for a session.
    fn handle_agent_message(
        &self,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Handle one runtime lifecycle event for `session_id`. Every accepted
    /// connection is dedicated to one session (see [`RuntimeProvisioner`]),
    /// so — unlike the wire protocol's events, which carry no identifier of
    /// their own — the caller always knows which session an event belongs to.
    fn handle_system_event(
        &self,
        session_id: Uuid,
        event: SystemEvent,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Handle a session's agent detaching (agent stopped or its runtime
    /// connection dropped): discard the session's in-flight turn state so a
    /// later agent instance starts from a clean slate.
    fn handle_agent_detached(&self, session_id: Uuid);
}

/// Per-session in-flight turn state.
struct SessionTurn {
    accumulator: TurnAccumulator,
    /// JSON-RPC request IDs of forwarded `session/prompt` requests that have
    /// not been answered yet. A response to one of these ends the turn.
    pending_prompts: Vec<agent_client_protocol::schema::v1::RequestId>,
    /// Correlates every live-stream item pushed for this turn, and doubles as
    /// the persisted assistant message's id once the turn flushes (mirrors
    /// `document_cognition_service`'s stream_id == message_id convention).
    stream_id: String,
}

impl SessionTurn {
    fn new() -> Self {
        Self {
            accumulator: TurnAccumulator::default(),
            pending_prompts: Vec::new(),
            stream_id: generate_uuid_v7().to_string(),
        }
    }
}

/// Concrete [`AgentProxyService`] implementation.
///
/// `R` is the chat persistence adapter (both [`ChatRepo`] and
/// [`MessageRepo`], e.g. `chat::outbound::postgres::PgChatRepo`).
pub struct AgentProxyServiceImpl<R, Sessions, Notifier, Provisioner> {
    repo: R,
    sessions: Sessions,
    notifier: Notifier,
    provisioner: Provisioner,
    /// Live-chat-stream sink, shared with `document_cognition_service` (same
    /// `ChatStream` wire shape, same Redis-durable-stream pipeline) so the
    /// frontend's existing chat renderer picks up external-agent turns with
    /// no changes of its own.
    streams: Arc<dyn StreamRepo>,
    turns: Mutex<HashMap<Uuid, SessionTurn>>,
}

impl<R, Sessions, Notifier, Provisioner> AgentProxyServiceImpl<R, Sessions, Notifier, Provisioner> {
    /// Create a new service from its ports.
    pub fn new(
        repo: R,
        sessions: Sessions,
        notifier: Notifier,
        provisioner: Provisioner,
        streams: Arc<dyn StreamRepo>,
    ) -> Self {
        Self {
            repo,
            sessions,
            notifier,
            provisioner,
            streams,
            turns: Mutex::new(HashMap::new()),
        }
    }
}

impl<R, Sessions, Notifier, Provisioner> AgentProxyServiceImpl<R, Sessions, Notifier, Provisioner>
where
    R: ChatRepo + MessageRepo,
    Sessions: RuntimeSessions,
    Notifier: ClientNotifier,
    Provisioner: RuntimeProvisioner,
{
    /// Require at least `level` access for `user_id` on the agent chat.
    async fn require_access(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
        level: AccessLevel,
    ) -> Result<AccessLevel> {
        let access = self
            .repo
            .get_access_level(user_id, &agent_id.to_string())
            .await?;
        if access < level {
            return Err(AgentProxyErr::Unauthorized);
        }
        Ok(access)
    }

    /// Best-effort gateway push; failures are logged, never propagated.
    async fn notify(
        &self,
        session_id: Uuid,
        message_type: &'static str,
        payload: serde_json::Value,
    ) {
        let _ = self
            .notifier
            .notify_session(session_id, message_type, payload)
            .await
            .inspect_err(
                |e| tracing::error!(error=?e, %session_id, message_type, "gateway notify failed"),
            );
    }

    /// Best-effort live-chat-stream push; failures are logged, never
    /// propagated (a dropped chunk shouldn't fail the request that produced
    /// it - the persisted message is the source of truth).
    async fn append_stream(&self, session_id: Uuid, stream_id: &str, item: ChatStream) {
        let Ok(payload) = serde_json::to_value(&item).inspect_err(
            |e| tracing::error!(error=?e, %session_id, "failed to serialize chat stream item"),
        ) else {
            return;
        };
        let id = StreamId {
            entity_type: EntityType::Chat,
            entity_id: session_id.to_string(),
            stream_id: stream_id.to_string(),
        };
        let _ = self.streams.append(&id, payload).await.inspect_err(
            |e| tracing::error!(error=?e, %session_id, "failed to append chat stream item"),
        );
    }

    /// Persist the user's prompt as a chat message and remember its request
    /// ID so the matching response ends the assistant turn.
    async fn store_prompt(
        &self,
        session_id: Uuid,
        request_id: agent_client_protocol::schema::v1::RequestId,
        prompt: PromptRequest,
    ) -> Result<()> {
        let text = content_blocks_text(&prompt.prompt);
        let now = Utc::now();
        let message = NewChatMessage {
            id: None,
            content: ChatMessageContent::Text(text.clone()),
            role: Role::User,
            attachments: None,
            model: EXTERNAL_AGENT_MODEL.to_string(),
            created_at: now,
            updated_at: now,
        };
        let message_id = MessageRepo::create(&self.repo, &session_id.to_string(), message).await?;

        let stream_id = {
            let mut turns = self.turns.lock().expect("turns mutex poisoned");
            let turn = turns.entry(session_id).or_insert_with(SessionTurn::new);
            turn.pending_prompts.push(request_id);
            turn.stream_id.clone()
        };

        self.append_stream(
            session_id,
            &stream_id,
            ChatStream::ChatUserMessage {
                stream_id: stream_id.clone(),
                chat_id: session_id.to_string(),
                message_id,
                content: text,
                attachments: Vec::new(),
            },
        )
        .await;

        Ok(())
    }

    /// Persist the accumulated assistant turn as one chat message.
    async fn flush_turn(&self, session_id: Uuid) -> Result<()> {
        let (parts, stream_id) = {
            let mut turns = self.turns.lock().expect("turns mutex poisoned");
            let Some(turn) = turns.get_mut(&session_id) else {
                return Ok(());
            };
            let parts = turn.accumulator.take();
            let stream_id = turn.stream_id.clone();
            // Drop fully-drained sessions so the map does not grow without
            // bound across the proxy's lifetime.
            if turn.pending_prompts.is_empty() {
                turns.remove(&session_id);
            }
            (parts, stream_id)
        };

        // Signal end-of-turn regardless of whether the agent produced any
        // visible content, so the frontend's stream indicator never hangs on
        // a silent turn (mirrors document_cognition_service, which always
        // emits `StreamEnd` when its loop finishes).
        self.append_stream(
            session_id,
            &stream_id,
            ChatStream::StreamEnd {
                stream_id: stream_id.clone(),
            },
        )
        .await;

        if parts.is_empty() {
            return Ok(());
        }

        let now = Utc::now();
        let message = NewChatMessage {
            id: Some(stream_id),
            content: ChatMessageContent::AssistantMessageParts(parts),
            role: Role::Assistant,
            attachments: None,
            model: EXTERNAL_AGENT_MODEL.to_string(),
            created_at: now,
            updated_at: now,
        };
        MessageRepo::create(&self.repo, &session_id.to_string(), message).await?;

        Ok(())
    }

    /// Whether `response_id` answers a pending prompt for the session.
    fn take_pending_prompt(
        &self,
        session_id: Uuid,
        response_id: &agent_client_protocol::schema::v1::RequestId,
    ) -> bool {
        let mut turns = self.turns.lock().expect("turns mutex poisoned");
        let Some(turn) = turns.get_mut(&session_id) else {
            return false;
        };
        let before = turn.pending_prompts.len();
        turn.pending_prompts.retain(|id| id != response_id);
        let taken = before != turn.pending_prompts.len();
        // Prune fully-drained sessions (e.g. after a failed-send rollback)
        // so the map does not accrete empty entries.
        if turn.pending_prompts.is_empty() && turn.accumulator.is_empty() {
            turns.remove(&session_id);
        }
        taken
    }
}

impl<R, Sessions, Notifier, Provisioner> AgentProxyService
    for AgentProxyServiceImpl<R, Sessions, Notifier, Provisioner>
where
    R: ChatRepo + MessageRepo,
    Sessions: RuntimeSessions,
    Notifier: ClientNotifier,
    Provisioner: RuntimeProvisioner,
{
    #[tracing::instrument(err, skip(self, args), fields(name = %args.name))]
    async fn create_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateAgentArgs,
    ) -> Result<Uuid> {
        if args.name.graphemes(true).count() > 100 {
            return Err(AgentProxyErr::BadRequest("name too long".to_string()));
        }

        let chat_id = ChatRepo::create(
            &self.repo,
            user_id,
            CreateChatArgs {
                name: args.name,
                project_id: args.project_id,
                kind: args.kind,
            },
        )
        .await?;

        Ok(string_to_uuid(&chat_id)?)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> Result<GetAgentResponse> {
        let access = self
            .require_access(user_id, agent_id, AccessLevel::View)
            .await?;
        let id = agent_id.to_string();
        let kind = self.repo.get_agent_kind(&id).await?;
        let chat = ChatRepo::get_chat(&self.repo, &id).await?;

        Ok(GetAgentResponse {
            chat,
            kind,
            user_access_level: access,
        })
    }

    #[tracing::instrument(err, skip(self, args))]
    async fn patch_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
        args: PatchAgentArgs,
    ) -> Result<()> {
        self.require_access(user_id.clone(), agent_id, AccessLevel::Edit)
            .await?;

        self.repo
            .patch(
                user_id,
                &agent_id.to_string(),
                PatchChatArgs {
                    name: args.name,
                    project_id: args.project_id,
                    share_permission: None,
                },
            )
            .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_agent(&self, user_id: MacroUserIdStr<'static>, agent_id: Uuid) -> Result<()> {
        self.require_access(user_id, agent_id, AccessLevel::Owner)
            .await?;
        ChatRepo::delete(&self.repo, &agent_id.to_string()).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn permanently_delete_agent(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> Result<()> {
        self.require_access(user_id, agent_id, AccessLevel::Owner)
            .await?;
        self.repo.permanently_delete(&agent_id.to_string()).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn provision_runtime_connection(
        &self,
        user_id: MacroUserIdStr<'static>,
        agent_id: Uuid,
    ) -> Result<String> {
        self.require_access(user_id, agent_id, AccessLevel::Edit)
            .await?;
        let kind = self.repo.get_agent_kind(&agent_id.to_string()).await?;
        if kind != ChatAgentKind::External {
            return Err(AgentProxyErr::BadRequest(
                "session is not an external agent".to_string(),
            ));
        }
        self.provisioner
            .provision(agent_id)
            .await
            .map_err(AgentProxyErr::Unknown)
    }

    #[tracing::instrument(err, skip(self, message))]
    async fn post_acp(
        &self,
        user_id: MacroUserIdStr<'static>,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> Result<()> {
        // Access first: a missing or foreign chat answers 404/403 without
        // leaking what kind of entity it is.
        self.require_access(user_id, session_id, AccessLevel::Edit)
            .await?;
        let kind = self.repo.get_agent_kind(&session_id.to_string()).await?;
        if kind != ChatAgentKind::External {
            return Err(AgentProxyErr::BadRequest(
                "session is not an external agent".to_string(),
            ));
        }
        // Fail fast before persisting anything when no runtime is attached;
        // the send below still guards against a disconnect racing this check.
        if !self.sessions.is_connected(session_id) {
            return Err(AgentProxyErr::SessionNotConnected);
        }

        let mut pending_prompt = None;
        if let RawJsonRpcMessage::Request(request) = &message
            && PromptRequest::matches_method(request.method.as_ref())
        {
            let params = request
                .params
                .clone()
                .map(RawJsonRpcParams::into_value)
                .unwrap_or(serde_json::Value::Null);
            let prompt = PromptRequest::parse_message(request.method.as_ref(), &params)
                .map_err(|e| AgentProxyErr::BadRequest(format!("invalid prompt request: {e}")))?;
            self.store_prompt(session_id, request.id.clone(), prompt)
                .await?;
            pending_prompt = Some(request.id.clone());
        }

        self.sessions.send(session_id, message).inspect_err(|_| {
            // The runtime vanished between the check and the send: the
            // prompt never reached an agent, so no response will ever end
            // this turn — take the pending ID back.
            if let Some(request_id) = &pending_prompt {
                self.take_pending_prompt(session_id, request_id);
            }
        })
    }

    #[tracing::instrument(err, skip(self, message))]
    async fn handle_agent_message(
        &self,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> Result<()> {
        match &message {
            RawJsonRpcMessage::Notification(notification)
                if SessionNotification::matches_method(notification.method.as_ref()) =>
            {
                let params = notification
                    .params
                    .clone()
                    .map(RawJsonRpcParams::into_value)
                    .unwrap_or(serde_json::Value::Null);
                let update =
                    SessionNotification::parse_message(notification.method.as_ref(), &params)
                        .map_err(|e| {
                            AgentProxyErr::BadRequest(format!("invalid session update: {e}"))
                        })?;

                if let Some(part) = translate_session_update(update.update) {
                    // Accumulate only into a turn a prompt opened (the entry
                    // is created by store_prompt); unsolicited chunks are
                    // dropped, and chunks buffered across an agent detach
                    // cannot resurrect the session's discarded turn state.
                    let stream_id = {
                        let mut turns = self.turns.lock().expect("turns mutex poisoned");
                        turns.get_mut(&session_id).map(|turn| {
                            turn.accumulator.push(part.clone());
                            turn.stream_id.clone()
                        })
                    };
                    if let Some(stream_id) = stream_id {
                        self.append_stream(
                            session_id,
                            &stream_id,
                            ChatStream::ChatMessageResponse {
                                stream_id: stream_id.clone(),
                                message_id: stream_id.clone(),
                                chat_id: session_id.to_string(),
                                content: part,
                            },
                        )
                        .await;
                    }
                }
            }
            RawJsonRpcMessage::Response(_) => {
                if let Some(response_id) = message.response_id()
                    && self.take_pending_prompt(session_id, response_id)
                {
                    self.flush_turn(session_id).await?;
                }
            }
            _ => {}
        }

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    fn handle_agent_detached(&self, session_id: Uuid) {
        let mut turns = self.turns.lock().expect("turns mutex poisoned");
        if turns.remove(&session_id).is_some() {
            tracing::debug!(%session_id, "discarded in-flight turn state");
        }
    }

    #[tracing::instrument(err, skip(self, event), fields(event_name = %event.as_str()))]
    async fn handle_system_event(&self, session_id: Uuid, event: SystemEvent) -> Result<()> {
        let payload =
            serde_json::to_value(&event).map_err(|e| AgentProxyErr::Unknown(anyhow::anyhow!(e)))?;
        self.notify(
            session_id,
            AGENT_SYSTEM_EVENT_MESSAGE_TYPE,
            serde_json::json!({
                "type": AGENT_SYSTEM_EVENT_MESSAGE_TYPE,
                "chat_id": session_id,
                "event": payload,
            }),
        )
        .await;

        Ok(())
    }
}
