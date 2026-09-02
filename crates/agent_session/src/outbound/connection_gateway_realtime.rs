//! The wire contract for streaming a live session's log, and the
//! connection-gateway adapter that speaks it.
//!
//! # The contract
//!
//! Websocket payloads are not part of the OpenAPI surface, so nothing
//! generates the client's half of this. The paired type is
//! `apps/web/src/lib/queries/agent-session/realtime-protocol.ts`, hand-written against
//! what is here; the two doc comments point at each other and are the whole
//! agreement.
//!
//! Messages go out as type [`AGENT_SESSION_LOG`] with a
//! [`AgentSessionLogEvent`] body:
//!
//! ```json
//! {
//!   "agentSessionId": "019f…",
//!   "createdAt":      "2026-08-13T12:34:56.789Z",
//!   "userId":         "macro|someone@example.com",
//!   "direction":      "to_server",
//!   "content":        { "type": "acp", "jsonrpc": "2.0", … }
//! }
//! ```
//!
//! The last four fields are exactly the entry shape
//! `GET /agent-sessions/{id}/log` serves, flattened in the same way. That is
//! the point of the contract rather than an accident of it: a client catching
//! up on a log and a client following one are folding the same bytes, so they
//! can share one fold and cannot disagree about what a frame means.
//!
//! `agentSessionId` both addresses the frame and is what the fold keys its
//! messages on, so it must be passed through unchanged: a message is
//! identified by that session plus the session-local `"{turn}:{author}"` id
//! the fold derives.

use crate::domain::model::QueuedActionDto;
use crate::domain::model::{
    AgentSessionId, AgentSessionLog, AgentSessionRenamed, LogAppended, Message,
    StoredAgentSessionLog,
};
use crate::domain::ports::{AgentSessionQueueChanged, AgentSessionRealtime};
use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType as GatewayEntityType;
use serde::Serialize;
use std::sync::Arc;

/// The realtime message type carrying one appended log frame.
///
/// Matched on by the web client's websocket dispatch; changing it breaks
/// streaming silently, since an unrecognized type is ignored rather than
/// rejected.
pub const AGENT_SESSION_LOG: &str = "agent_session_log";

/// The realtime message type carrying a persisted session-name change.
pub const AGENT_SESSION_RENAMED: &str = "agent_session_renamed";

/// The realtime message type carrying a session's whole queue after a change.
///
/// Always the full queue, never a delta: any one event is a complete,
/// self-sufficient truth, which is what lets a client treat the socket as the
/// only writer once it has heard anything on it - a late `GET .../queue`
/// response can never carry information the socket will not deliver.
pub const AGENT_SESSION_QUEUE: &str = "agent_session_queue";

/// The body of an [`AGENT_SESSION_LOG`] message - the module docs are the
/// contract.
#[derive(Debug, Serialize)]
pub struct AgentSessionLogEvent {
    /// The session the frame belongs to, and half of the composite id its
    /// folded messages are keyed by.
    #[serde(rename = "agentSessionId")]
    pub agent_session_id: Uuid,
    /// When the durable log recorded the frame.
    #[serde(rename = "createdAt")]
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// The user whose action produced the frame, when one did.
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// `direction` and `content`, flattened in - the frame's own two fields,
    /// serialized by [`Message`] itself so they match the log verbatim.
    #[serde(flatten)]
    pub message: Message,
}

/// User-facing metadata changed for an agent session.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRenamedEvent {
    /// Renamed session.
    pub agent_session_id: Uuid,
    /// New user-facing name.
    pub name: String,
}

impl From<AgentSessionRenamed> for AgentSessionRenamedEvent {
    fn from(event: AgentSessionRenamed) -> Self {
        Self {
            agent_session_id: event.agent_session_id.as_uuid(),
            name: event.name,
        }
    }
}

/// The body of an [`AGENT_SESSION_QUEUE`] message.
///
/// `entries` are [`QueuedActionDto`] - the exact rows `GET .../queue` serves -
/// for the same reason the log event flattens [`Message`] verbatim: a client
/// baselining from the REST endpoint and one following the socket are reading
/// the same bytes, so they cannot disagree about what an entry means.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionQueueEvent {
    /// The session whose queue this is.
    pub agent_session_id: Uuid,
    /// Everything waiting, oldest (next to dispatch) first. The whole queue,
    /// every time - see [`AGENT_SESSION_QUEUE`].
    pub entries: Vec<QueuedActionDto>,
}

impl From<AgentSessionQueueChanged> for AgentSessionQueueEvent {
    fn from(event: AgentSessionQueueChanged) -> Self {
        Self {
            agent_session_id: event.agent_session_id.as_uuid(),
            entries: event.entries.into_iter().map(Into::into).collect(),
        }
    }
}

impl AgentSessionLogEvent {
    /// The event for one appended frame.
    #[must_use]
    pub fn new(event: LogAppended) -> Self {
        let StoredAgentSessionLog {
            created_at,
            entry: AgentSessionLog {
                user_id, content, ..
            },
        } = event.entry;

        Self {
            agent_session_id: event.agent_session_id.as_uuid(),
            created_at,
            user_id: user_id.map(|user| user.to_string()),
            message: content,
        }
    }
}

/// Publishes appended frames to a session's viewers through the connection
/// gateway.
#[derive(Clone)]
pub struct ConnectionGatewayAgentSessionRealtime<Participants> {
    client: Arc<ConnectionGatewayClient>,
    participants: Participants,
}

impl<Participants> ConnectionGatewayAgentSessionRealtime<Participants> {
    /// Build the adapter from a gateway client and a way to ask who is in a
    /// channel.
    pub fn new(client: Arc<ConnectionGatewayClient>, participants: Participants) -> Self {
        Self {
            client,
            participants,
        }
    }
}

/// Who should receive a session's frames.
///
/// The gateway addresses users, so publishing needs a list of them. Named as
/// its own capability rather than reaching for a repository, because this is
/// the only thing the adapter wants from one.
///
/// Asked by session rather than by channel: a session created since they
/// stopped owning a channel has no membership list to consult. The answer is
/// the same either way for older sessions, whose channel only ever had one
/// participant - the owner, written by `create`.
pub trait SessionAudience: Send + Sync + 'static {
    /// The users who should see this session's frames.
    fn viewers(
        &self,
        agent_session_id: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send;
}

impl<Participants> AgentSessionRealtime for ConnectionGatewayAgentSessionRealtime<Participants>
where
    Participants: SessionAudience,
{
    async fn publish(&self, event: LogAppended) -> Result<(), rootcause::Report> {
        let recipients = self.participants.viewers(event.agent_session_id).await?;
        if recipients.is_empty() {
            return Ok(());
        }

        let payload = serde_json::to_value(AgentSessionLogEvent::new(event))
            .map_err(|error| rootcause::report!(error))?;

        self.client
            .batch_send_message(
                AGENT_SESSION_LOG.to_string(),
                payload,
                recipients
                    .iter()
                    .map(|user| GatewayEntityType::User.with_entity_str(user.as_ref()))
                    .collect(),
            )
            .await
            .map_err(|error| rootcause::report!(error))?;

        Ok(())
    }

    async fn publish_queue_changed(
        &self,
        event: AgentSessionQueueChanged,
    ) -> Result<(), rootcause::Report> {
        let recipients = self.participants.viewers(event.agent_session_id).await?;
        if recipients.is_empty() {
            return Ok(());
        }

        let payload = serde_json::to_value(AgentSessionQueueEvent::from(event))
            .map_err(|error| rootcause::report!(error))?;
        self.client
            .batch_send_message(
                AGENT_SESSION_QUEUE.to_string(),
                payload,
                recipients
                    .iter()
                    .map(|user| GatewayEntityType::User.with_entity_str(user.as_ref()))
                    .collect(),
            )
            .await
            .map_err(|error| rootcause::report!(error))?;

        Ok(())
    }

    async fn publish_renamed(&self, event: AgentSessionRenamed) -> Result<(), rootcause::Report> {
        let recipients = self.participants.viewers(event.agent_session_id).await?;
        if recipients.is_empty() {
            return Ok(());
        }

        let payload = serde_json::to_value(AgentSessionRenamedEvent::from(event))
            .map_err(|error| rootcause::report!(error))?;
        self.client
            .batch_send_message(
                AGENT_SESSION_RENAMED.to_string(),
                payload,
                recipients
                    .iter()
                    .map(|user| GatewayEntityType::User.with_entity_str(user.as_ref()))
                    .collect(),
            )
            .await
            .map_err(|error| rootcause::report!(error))?;

        Ok(())
    }
}
