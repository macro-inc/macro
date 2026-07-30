//! The agent proxy domain service.

#[cfg(test)]
mod test;

use crate::domain::models::{
    AgentProxyErr, CreateAgentArgs, GetAgentResponse, PatchAgentArgs, Result,
};
use crate::domain::ports::{ClientNotifier, PendingMessage, PendingMessages, RuntimeSessions};
use crate::domain::translate::{TurnAccumulator, content_blocks_text, translate_session_update};
use agent::types::{ChatMessageContent, Role};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    InitializeRequest, NewSessionRequest, NewSessionResponse, PromptRequest, RequestId,
    Response as AcpResponse, SessionNotification,
};
use agent_client_protocol::{JsonRpcMessage, JsonRpcResponse};
use agent_client_protocol::{RawJsonRpcMessage, RawJsonRpcParams};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use chat::domain::models::{ChatAgentKind, ChatStream, CreateChatArgs, PatchChatArgs};
use chat::domain::ports::{ChatRepo, MessageRepo};
use chrono::Utc;
use futures::channel::oneshot;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7, string_to_uuid};
use model::chat::NewChatMessage;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use stream::domain::{StreamId, StreamRepo};
use unicode_segmentation::UnicodeSegmentation;

/// Model string recorded on messages persisted for external agent sessions.
pub const EXTERNAL_AGENT_MODEL: &str = "external";

/// Gateway message type for agent runtime lifecycle events.
pub const AGENT_SYSTEM_EVENT_MESSAGE_TYPE: &str = "agent_system_event";

/// Working directory every ACP session is created in, matching the sandbox
/// layout `coding-agent-worker` clones the repo into (see its
/// `container/sidecar`, which defaults `ACP_WORKSPACE` to the same path).
const ACP_WORKSPACE: &str = "/workspace";

/// Reserved JSON-RPC request id for the proxy-initiated `initialize` call
/// that opens a runtime connection's ACP handshake. Namespaced so it can
/// never collide with a caller-supplied `post_acp` request id.
const ACP_BOOTSTRAP_INITIALIZE_ID: &str = "agent_proxy:initialize";

/// Reserved JSON-RPC request id for the proxy-initiated `session/new` call
/// that creates the ACP session every subsequent message is addressed to.
const ACP_BOOTSTRAP_NEW_SESSION_ID: &str = "agent_proxy:session/new";

/// Build a raw JSON-RPC request from a typed ACP request and id.
fn acp_request(
    id: RequestId,
    request: &(impl JsonRpcMessage + Serialize),
) -> Result<RawJsonRpcMessage> {
    let params =
        serde_json::to_value(request).map_err(|e| AgentProxyErr::Unknown(anyhow::anyhow!(e)))?;
    RawJsonRpcMessage::request(request.method().to_string(), params, id)
        .map_err(|e| AgentProxyErr::Unknown(anyhow::anyhow!(e)))
}

/// Parse and validate a `session/prompt` request's params, so a malformed
/// prompt fails with a 400 for the caller regardless of when delivery to a
/// runtime happens.
fn parse_prompt_request(method: &str, params: &Option<RawJsonRpcParams>) -> Result<PromptRequest> {
    let params = params
        .clone()
        .map(RawJsonRpcParams::into_value)
        .unwrap_or(serde_json::Value::Null);
    PromptRequest::parse_message(method, &params)
        .map_err(|e| AgentProxyErr::BadRequest(format!("invalid prompt request: {e}")))
}

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

    /// Start a runtime's ACP session once it reports readiness: negotiates
    /// `initialize` then creates a session via `session/new`, recording the
    /// resulting ACP session id so `post_acp` can stamp it onto every message
    /// sent to this runtime. Called at most once per accepted connection,
    /// after its `SystemEvent::AcpReady` event arrives (not merely on
    /// connect: the runtime's hosted agent process may not exist yet at that
    /// point), and before any user traffic can be forwarded to it.
    ///
    /// Once the ACP session exists, any messages `post_acp` queued while the
    /// session had no ready runtime are flushed into it, oldest first.
    fn handle_agent_connected(&self, session_id: Uuid) -> impl Future<Output = Result<()>> + Send;

    /// Forward one user-posted ACP message to the runtime hosting the
    /// session, persisting prompts as user chat messages.
    ///
    /// If the session exists but has no ready runtime (none connected, or
    /// its ACP bootstrap hasn't completed), the message is durably queued
    /// instead and delivered by [`Self::handle_agent_connected`] once a
    /// runtime's ACP session is ready; prompts are persisted as user chat
    /// messages at queue time.
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
    /// connection is dedicated to one session (see
    /// [`crate::outbound::shared_runtime_connections::SharedRuntimeConnections`]),
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
    pending_prompts: Vec<RequestId>,
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
pub struct AgentProxyServiceImpl<R, Sessions, Notifier, Queue> {
    repo: R,
    sessions: Sessions,
    notifier: Notifier,
    queue: Queue,
    /// Live-chat-stream sink, shared with `document_cognition_service` (same
    /// `ChatStream` wire shape, same Redis-durable-stream pipeline) so the
    /// frontend's existing chat renderer picks up external-agent turns with
    /// no changes of its own.
    streams: Arc<dyn StreamRepo>,
    turns: Mutex<HashMap<Uuid, SessionTurn>>,
    /// The ACP-level session id for each connected runtime, once its
    /// `session/new` handshake completes. `post_acp` stamps this onto every
    /// outgoing session-scoped message so callers never need to know it.
    acp_sessions: Mutex<HashMap<Uuid, String>>,
    /// ACP session bootstraps in flight, resolved by `handle_agent_message`
    /// when the matching `session/new` response arrives.
    acp_bootstrap: Mutex<HashMap<Uuid, oneshot::Sender<std::result::Result<String, String>>>>,
}

impl<R, Sessions, Notifier, Queue> AgentProxyServiceImpl<R, Sessions, Notifier, Queue> {
    /// Create a new service from its ports.
    pub fn new(
        repo: R,
        sessions: Sessions,
        notifier: Notifier,
        queue: Queue,
        streams: Arc<dyn StreamRepo>,
    ) -> Self {
        Self {
            repo,
            sessions,
            notifier,
            queue,
            streams,
            turns: Mutex::new(HashMap::new()),
            acp_sessions: Mutex::new(HashMap::new()),
            acp_bootstrap: Mutex::new(HashMap::new()),
        }
    }
}

impl<R, Sessions, Notifier, Queue> AgentProxyServiceImpl<R, Sessions, Notifier, Queue>
where
    R: ChatRepo + MessageRepo,
    Sessions: RuntimeSessions,
    Notifier: ClientNotifier,
    Queue: PendingMessages,
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
        request_id: RequestId,
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
    fn take_pending_prompt(&self, session_id: Uuid, response_id: &RequestId) -> bool {
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

    /// Log then forward a raw ACP message to the runtime hosting the
    /// session.
    fn send_to_runtime(&self, session_id: Uuid, message: RawJsonRpcMessage) -> Result<()> {
        tracing::debug!(
            %session_id,
            message = %serde_json::to_string(&message).unwrap_or_default(),
            "sending ACP message to runtime"
        );
        self.sessions.send(session_id, message)
    }

    /// The session's live ACP session id, or [`AgentProxyErr::AcpSessionNotReady`]
    /// if `handle_agent_connected` hasn't finished (or failed) creating one.
    fn require_acp_session_id(&self, session_id: Uuid) -> Result<String> {
        self.acp_sessions
            .lock()
            .expect("acp sessions mutex poisoned")
            .get(&session_id)
            .cloned()
            .ok_or(AgentProxyErr::AcpSessionNotReady)
    }

    /// Whether the session's ACP bootstrap has completed and its ACP
    /// session id is live - i.e. whether `post_acp` can deliver immediately
    /// rather than queue. Cleared again by `handle_agent_detached`.
    fn has_acp_session(&self, session_id: Uuid) -> bool {
        self.acp_sessions
            .lock()
            .expect("acp sessions mutex poisoned")
            .contains_key(&session_id)
    }

    /// Stamp the runtime's live ACP session id onto a request or
    /// notification's `sessionId` param, overwriting whatever the caller
    /// supplied, so callers never need to know the ACP-level id themselves.
    /// Only touches params that already have a `sessionId` key - every
    /// session-scoped ACP method requires one, so a typed request the
    /// caller built always has one (even if it's the wrong value); a
    /// connection-level method like `initialize` never does, and passes
    /// through untouched. Messages with no object params (or responses,
    /// which answer a request rather than address one) also pass through.
    fn attach_acp_session_id(
        &self,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> Result<RawJsonRpcMessage> {
        Ok(match message {
            RawJsonRpcMessage::Request(mut request) => {
                if let Some(RawJsonRpcParams::Object(params)) = &mut request.params
                    && params.contains_key("sessionId")
                {
                    let acp_session_id = self.require_acp_session_id(session_id)?;
                    params.insert(
                        "sessionId".to_string(),
                        serde_json::Value::String(acp_session_id),
                    );
                }
                RawJsonRpcMessage::Request(request)
            }
            RawJsonRpcMessage::Notification(mut notification) => {
                if let Some(RawJsonRpcParams::Object(params)) = &mut notification.params
                    && params.contains_key("sessionId")
                {
                    let acp_session_id = self.require_acp_session_id(session_id)?;
                    params.insert(
                        "sessionId".to_string(),
                        serde_json::Value::String(acp_session_id),
                    );
                }
                RawJsonRpcMessage::Notification(notification)
            }
            response @ RawJsonRpcMessage::Response(_) => response,
        })
    }

    /// Persist a `session/prompt` as a user chat message, then forward its
    /// already-built JSON-RPC request to the runtime, rolling the persisted
    /// message's pending-turn bookkeeping back if the send fails (the
    /// runtime vanished between the check and the send: the prompt never
    /// reached an agent, so no response will ever end this turn).
    async fn store_and_forward_prompt(
        &self,
        session_id: Uuid,
        request_id: RequestId,
        prompt: PromptRequest,
        message: RawJsonRpcMessage,
    ) -> Result<()> {
        self.store_prompt(session_id, request_id.clone(), prompt)
            .await?;
        self.send_to_runtime(session_id, message).inspect_err(|_| {
            self.take_pending_prompt(session_id, &request_id);
        })
    }

    /// Re-record a queued prompt's request id as awaiting a response. The
    /// enqueue already did this, but a detach since then discards turn
    /// state, so the flush re-pushes (deduped) to guarantee the prompt's
    /// response still ends the turn.
    fn push_pending_prompt(&self, session_id: Uuid, request_id: RequestId) {
        let mut turns = self.turns.lock().expect("turns mutex poisoned");
        let turn = turns.entry(session_id).or_insert_with(SessionTurn::new);
        if !turn.pending_prompts.contains(&request_id) {
            turn.pending_prompts.push(request_id);
        }
    }

    /// Deliver every message queued while the session had no ready runtime,
    /// oldest first. Stops at the first send failure, leaving that row and
    /// everything after it queued for the next connection's flush (a failed
    /// send means this runtime is on its way out, so forcing the rest
    /// through is pointless); prompt bookkeeping pushed above is rolled back
    /// for the failed message so it is re-pushed by that later flush.
    async fn flush_pending(&self, session_id: Uuid) -> Result<()> {
        let pending = self
            .queue
            .list(session_id)
            .await
            .map_err(AgentProxyErr::Unknown)?;
        for PendingMessage { id, message } in pending {
            let message = self.attach_acp_session_id(session_id, message)?;
            let prompt_id = match &message {
                RawJsonRpcMessage::Request(request)
                    if PromptRequest::matches_method(request.method.as_ref()) =>
                {
                    Some(request.id.clone())
                }
                _ => None,
            };
            if let Some(request_id) = &prompt_id {
                self.push_pending_prompt(session_id, request_id.clone());
            }
            if let Err(e) = self.send_to_runtime(session_id, message) {
                if let Some(request_id) = prompt_id {
                    self.take_pending_prompt(session_id, &request_id);
                }
                tracing::warn!(error=?e, %session_id, "failed to deliver queued message; keeping it queued");
                break;
            }
            self.queue
                .delete(id)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, %session_id, "failed to delete delivered queued message")
                })
                .ok();
        }
        Ok(())
    }

    /// Resolve an in-flight `session/new` bootstrap from its response,
    /// delivering the created ACP session id (or a failure reason) to
    /// whichever `handle_agent_connected` call is waiting on it. A no-op if
    /// no bootstrap is pending (e.g. it already resolved, or the connection
    /// was detached first).
    fn resolve_new_session_bootstrap(&self, session_id: Uuid, message: &RawJsonRpcMessage) {
        let Some(tx) = self
            .acp_bootstrap
            .lock()
            .expect("acp bootstrap mutex poisoned")
            .remove(&session_id)
        else {
            return;
        };

        let resolution = match message {
            RawJsonRpcMessage::Response(AcpResponse::Result { result, .. }) => {
                NewSessionResponse::from_value("session/new", result.clone())
                    .map(|response| response.session_id.0.to_string())
                    .map_err(|e| e.to_string())
            }
            RawJsonRpcMessage::Response(AcpResponse::Error { error, .. }) => Err(error.to_string()),
            _ => Err("expected a response to session/new".to_string()),
        };

        let _ = tx.send(resolution);
    }
}

impl<R, Sessions, Notifier, Queue> AgentProxyService
    for AgentProxyServiceImpl<R, Sessions, Notifier, Queue>
where
    R: ChatRepo + MessageRepo,
    Sessions: RuntimeSessions,
    Notifier: ClientNotifier,
    Queue: PendingMessages,
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
    async fn handle_agent_connected(&self, session_id: Uuid) -> Result<()> {
        let (tx, rx) = oneshot::channel();
        self.acp_bootstrap
            .lock()
            .expect("acp bootstrap mutex poisoned")
            .insert(session_id, tx);

        self.send_to_runtime(
            session_id,
            acp_request(
                RequestId::Str(ACP_BOOTSTRAP_INITIALIZE_ID.to_string()),
                &InitializeRequest::new(ProtocolVersion::V1),
            )?,
        )?;
        self.send_to_runtime(
            session_id,
            acp_request(
                RequestId::Str(ACP_BOOTSTRAP_NEW_SESSION_ID.to_string()),
                &NewSessionRequest::new(ACP_WORKSPACE),
            )?,
        )?;

        let acp_session_id = match rx.await {
            Ok(Ok(id)) => id,
            Ok(Err(message)) => {
                return Err(AgentProxyErr::Unknown(anyhow::anyhow!(
                    "session/new failed: {message}"
                )));
            }
            Err(_) => {
                return Err(AgentProxyErr::Unknown(anyhow::anyhow!(
                    "runtime disconnected before its ACP session was created"
                )));
            }
        };

        self.acp_sessions
            .lock()
            .expect("acp sessions mutex poisoned")
            .insert(session_id, acp_session_id.clone());
        tracing::info!(%session_id, acp_session_id, "ACP session ready");

        // The session is ready from this line on: anything posted while it
        // was not - e.g. the prompt a caller supplied when launching the
        // runtime, posted through the HTTP API before the runtime even
        // existed - is delivered now, oldest first.
        self.flush_pending(session_id).await?;

        Ok(())
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
        // Ready means a runtime has completed its ACP bootstrap: only then
        // is there a live ACP session id to stamp and something to deliver
        // to. A session that exists but is not ready buffers the message
        // durably instead of erroring - `handle_agent_connected` flushes the
        // queue, oldest first, once a runtime's ACP session is ready.
        // Prompts are validated and persisted as user chat messages now, so
        // a malformed prompt still 400s and the user's message lands in
        // history immediately rather than whenever some runtime shows up.
        if !self.has_acp_session(session_id) {
            if let RawJsonRpcMessage::Request(request) = &message
                && PromptRequest::matches_method(request.method.as_ref())
            {
                let prompt = parse_prompt_request(request.method.as_ref(), &request.params)?;
                self.store_prompt(session_id, request.id.clone(), prompt)
                    .await?;
            }
            self.queue
                .enqueue(session_id, message)
                .await
                .map_err(AgentProxyErr::Unknown)?;
            return Ok(());
        }

        // Fail fast before persisting anything when no runtime is attached;
        // the send below still guards against a disconnect racing this check.
        if !self.sessions.is_connected(session_id) {
            return Err(AgentProxyErr::SessionNotConnected);
        }

        // Stamp the runtime's live ACP session id onto the message so
        // callers only ever need to know the Macro session id.
        let message = self.attach_acp_session_id(session_id, message)?;

        if let RawJsonRpcMessage::Request(request) = &message
            && PromptRequest::matches_method(request.method.as_ref())
        {
            let prompt = parse_prompt_request(request.method.as_ref(), &request.params)?;
            let request_id = request.id.clone();
            return self
                .store_and_forward_prompt(session_id, request_id, prompt, message)
                .await;
        }

        self.send_to_runtime(session_id, message)
    }

    #[tracing::instrument(err, skip(self, message))]
    async fn handle_agent_message(
        &self,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> Result<()> {
        tracing::debug!(
            %session_id,
            message = %serde_json::to_string(&message).unwrap_or_default(),
            "received ACP message from runtime"
        );

        // Bootstrap responses (initialize/session-new) are answered to the
        // proxy itself, not to any post_acp caller: intercept them here
        // rather than letting them fall into the pending-prompt matching
        // below, which only ever tracks user-posted `session/prompt` ids.
        if let Some(response_id) = message.response_id()
            && let RequestId::Str(id) = response_id
        {
            if id == ACP_BOOTSTRAP_NEW_SESSION_ID {
                self.resolve_new_session_bootstrap(session_id, &message);
                return Ok(());
            }
            if id == ACP_BOOTSTRAP_INITIALIZE_ID {
                return Ok(());
            }
        }

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
        drop(turns);

        // The next connection gets its own `handle_agent_connected` call and
        // therefore its own ACP session; stale state here would otherwise
        // let messages address a session id that no longer exists (or,
        // worse, unblock a `handle_agent_connected` call still waiting on a
        // bootstrap that will never resolve since the connection is gone).
        self.acp_sessions
            .lock()
            .expect("acp sessions mutex poisoned")
            .remove(&session_id);
        self.acp_bootstrap
            .lock()
            .expect("acp bootstrap mutex poisoned")
            .remove(&session_id);
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
