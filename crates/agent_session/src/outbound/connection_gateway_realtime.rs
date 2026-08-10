//! The wire contract for streaming a live session's log, and the
//! connection-gateway adapter that speaks it.
//!
//! # The contract
//!
//! Websocket payloads are not part of the OpenAPI surface, so nothing
//! generates the client's half of this. The paired type is
//! `apps/web/src/lib/core/agent-fold/stream-protocol.ts`, hand-written against
//! what is here; the two doc comments point at each other and are the whole
//! agreement.
//!
//! Messages go out as type [`AGENT_SESSION_LOG`] with a
//! [`AgentSessionLogEvent`] body:
//!
//! ```json
//! {
//!   "channelId":      "019f…",
//!   "agentSessionId": "019f…",
//!   "userId":         "macro|someone@example.com",
//!   "direction":      "to_server",
//!   "content":        { "type": "acp", "jsonrpc": "2.0", … }
//! }
//! ```
//!
//! The last three fields are exactly the entry shape
//! `GET /agent-sessions/channel/{id}/log` serves, flattened in the same way.
//! That is the point of the contract rather than an accident of it: a client
//! catching up on a log and a client following one are folding the same bytes,
//! so they can share one fold and cannot disagree about what a frame means.
//!
//! `channelId` addresses it — a viewer opened a channel and may not know a
//! session exists. `agentSessionId` is what the fold keys its messages on, so
//! it must be passed through unchanged: it is half of the
//! `"{agent_session_id}:{turn}:{author}"` that joins a folded message to the
//! placeholder row rendering it.

use crate::domain::model::{AgentSessionLog, LogAppended, Message};
use crate::domain::ports::AgentSessionRealtime;
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

/// The body of an [`AGENT_SESSION_LOG`] message - the module docs are the
/// contract.
#[derive(Debug, Serialize)]
pub struct AgentSessionLogEvent {
    /// The channel whose viewers should fold this.
    #[serde(rename = "channelId")]
    pub channel_id: Uuid,
    /// The session the frame belongs to, and half of the composite id its
    /// folded messages are keyed by.
    #[serde(rename = "agentSessionId")]
    pub agent_session_id: Uuid,
    /// The user whose action produced the frame, when one did.
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// `direction` and `content`, flattened in - the frame's own two fields,
    /// serialized by [`Message`] itself so they match the log verbatim.
    #[serde(flatten)]
    pub message: Message,
}

impl AgentSessionLogEvent {
    /// The event for one appended frame.
    #[must_use]
    pub fn new(event: LogAppended) -> Self {
        let LogAppended {
            channel_id,
            agent_session_id,
            entry: AgentSessionLog {
                user_id, content, ..
            },
        } = event;

        Self {
            channel_id,
            agent_session_id: agent_session_id.as_uuid(),
            user_id: user_id.map(|user| user.to_string()),
            message: content,
        }
    }
}

/// Publishes appended frames to a channel's participants through the
/// connection gateway.
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

/// Who should receive a channel's frames.
///
/// The gateway addresses users, not channels, so publishing needs the
/// membership list. Named as its own capability rather than reaching for a
/// channels repository, because this is the only thing the adapter wants from
/// one.
pub trait ChannelAudience: Send + Sync + 'static {
    /// The users currently participating in a channel.
    fn participants(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send;
}

impl<Participants> AgentSessionRealtime for ConnectionGatewayAgentSessionRealtime<Participants>
where
    Participants: ChannelAudience,
{
    async fn publish(&self, event: LogAppended) -> Result<(), rootcause::Report> {
        let channel_id = event.channel_id;
        let recipients = self.participants.participants(channel_id).await?;
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
}

#[cfg(test)]
mod test {
    use super::*;
    use agent_fold::testing::{TURN, parse_log_as, test_session};

    /// The event is the REST entry shape plus two ids - the property the
    /// client relies on to fold a streamed frame and a fetched one with the
    /// same code. Asserted on the serialized keys rather than the types,
    /// because it is the bytes the two halves actually agree on.
    #[test]
    fn an_event_is_a_log_entry_plus_two_ids() {
        let entry = parse_log_as(test_session(), TURN)
            .into_iter()
            .find(|entry| entry.user_id.is_some())
            .expect("the fixture attributes its prompt");

        let value = serde_json::to_value(AgentSessionLogEvent::new(LogAppended {
            channel_id: Uuid::from_u128(0xc4a2),
            agent_session_id: test_session(),
            entry,
        }))
        .expect("the event serializes");

        let object = value.as_object().expect("an event is a JSON object");
        assert_eq!(
            object.keys().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "channelId",
                "agentSessionId",
                "userId",
                "direction",
                "content"
            ],
            "the frame is flattened in beside the ids, not nested under them"
        );
        assert_eq!(object["direction"], "to_runtime");
        assert_eq!(object["content"]["method"], "session/prompt");
    }

    /// An unattributed frame omits the key rather than sending null, matching
    /// the REST entry and keeping `userId` optional on the client.
    #[test]
    fn an_unattributed_frame_omits_the_user() {
        let entry = parse_log_as(test_session(), TURN)
            .into_iter()
            .find(|entry| entry.user_id.is_none())
            .expect("the fixture has unattributed frames");

        let value = serde_json::to_value(AgentSessionLogEvent::new(LogAppended {
            channel_id: Uuid::from_u128(0xc4a2),
            agent_session_id: test_session(),
            entry,
        }))
        .expect("the event serializes");

        assert!(value.get("userId").is_none(), "got {value}");
    }
}
