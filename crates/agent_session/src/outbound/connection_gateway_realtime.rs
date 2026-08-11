//! The wire contract for streaming a live session's folded messages, and the
//! connection-gateway adapter that speaks it.
//!
//! # The contract
//!
//! Websocket payloads are not part of the OpenAPI surface, so nothing
//! generates the client's half of this. The message body is the same
//! [`FoldedMessageDto`] the REST endpoint serves
//! (`GET /agent-sessions/channel/{id}/messages`), so the generated schema for
//! that endpoint *is* the client's type for the event body; only the thin
//! envelope here is hand-written against, in
//! `apps/web/src/lib/queries/channel/agent-session-messages.ts`.
//!
//! Messages go out as type [`AGENT_SESSION_MESSAGE`] with an
//! [`AgentSessionMessageEvent`] body:
//!
//! ```json
//! {
//!   "channelId":      "019f…",
//!   "agentSessionId": "019f…",
//!   "kind":           "new",
//!   "logIndex":       42,
//!   "message":        { "agentSessionMessageId": "019f…:0:agent", … }
//! }
//! ```
//!
//! `channelId` addresses it - a viewer opened a channel and may not know a
//! session exists. `kind` is `"new"` the first time a message is reported and
//! `"update"` after; either way `message` is the whole message as it now
//! stands, so a reader applies both the same way - replace whatever it holds
//! under that `agentSessionMessageId`. `logIndex` pairs with the snapshot's
//! `logLength`: an event with `logIndex <= logLength` is already contained in
//! that snapshot and can be dropped.

use crate::domain::model::{FoldedMessageChange, FoldedMessagePublished};
use crate::domain::ports::AgentSessionRealtime;
use crate::wire::FoldedMessageDto;
use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType as GatewayEntityType;
use serde::Serialize;
use std::sync::Arc;

/// The realtime message type carrying one changed folded message.
///
/// Matched on by the web client's websocket dispatch; changing it breaks
/// streaming silently, since an unrecognized type is ignored rather than
/// rejected.
pub const AGENT_SESSION_MESSAGE: &str = "agent_session_message";

/// The body of an [`AGENT_SESSION_MESSAGE`] message - the module docs are the
/// contract.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMessageEvent {
    /// The channel whose viewers should see this.
    pub channel_id: Uuid,
    /// The session the message was folded from.
    pub agent_session_id: Uuid,
    /// `"new"` the first time a message is reported, `"update"` after.
    pub kind: &'static str,
    /// How many log frames the fold had consumed when it produced this - see
    /// the module docs for how a reader uses it.
    pub log_index: u64,
    /// The message as it now stands.
    pub message: FoldedMessageDto,
}

impl AgentSessionMessageEvent {
    /// The event for one changed message.
    #[must_use]
    pub fn new(event: FoldedMessagePublished) -> Self {
        Self {
            channel_id: event.channel_id,
            agent_session_id: event.agent_session_id.as_uuid(),
            kind: match event.change {
                FoldedMessageChange::New => "new",
                FoldedMessageChange::Updated => "update",
            },
            log_index: event.log_index,
            message: FoldedMessageDto::new(event.agent_session_id, event.message),
        }
    }
}

/// Publishes changed folded messages to a channel's participants through the
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

/// Who should receive a channel's messages.
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
    async fn publish(&self, event: FoldedMessagePublished) -> Result<(), rootcause::Report> {
        let channel_id = event.channel_id;
        let recipients = self.participants.participants(channel_id).await?;
        if recipients.is_empty() {
            return Ok(());
        }

        let payload = serde_json::to_value(AgentSessionMessageEvent::new(event))
            .map_err(|error| rootcause::report!(error))?;

        self.client
            .batch_send_message(
                AGENT_SESSION_MESSAGE.to_string(),
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
    use crate::domain::model::AgentSessionId;
    use agent_fold::domain::fold::fold;
    use agent_fold::testing::{TURN, parse_log_as, test_session};

    fn folded_event(session: AgentSessionId) -> AgentSessionMessageEvent {
        let messages = fold(parse_log_as(session, TURN));
        let message = messages.into_iter().next().expect("the fixture folds");
        AgentSessionMessageEvent::new(FoldedMessagePublished {
            channel_id: Uuid::from_u128(0xc4a2),
            agent_session_id: session,
            change: FoldedMessageChange::New,
            log_index: 7,
            message,
        })
    }

    /// The event's `message` is the REST endpoint's DTO shape - the property
    /// the client relies on to render a streamed message and a fetched one
    /// with the same code. Asserted on the serialized keys because it is the
    /// bytes the two halves actually agree on.
    #[test]
    fn an_event_carries_the_rest_message_shape_plus_the_envelope() {
        let value =
            serde_json::to_value(folded_event(test_session())).expect("the event serializes");

        let object = value.as_object().expect("an event is a JSON object");
        assert_eq!(
            object.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["channelId", "agentSessionId", "kind", "logIndex", "message"],
            "the message is nested under a thin addressed envelope"
        );
        assert_eq!(object["kind"], "new");
        assert_eq!(object["logIndex"], 7);

        let message = object["message"]
            .as_object()
            .expect("the body is a folded message");
        assert!(
            message["agentSessionMessageId"]
                .as_str()
                .expect("the composite id is a string")
                .starts_with(&test_session().as_uuid().to_string()),
            "the composite id is keyed by the session"
        );
        assert!(message["parts"].is_array(), "got {message:?}");
    }
}
