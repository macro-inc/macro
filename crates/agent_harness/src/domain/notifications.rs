//! From one lifecycle fact to the notifications it warrants.
//!
//! Pure: the fact carries everything needed (the audience is resolved before
//! publishing), and what comes out is the notifications to send through the
//! [`AgentSessionNotifier`](super::ports::AgentSessionNotifier) port. The
//! adapter that sends them lives in `outbound::notifications`; this is the
//! part worth testing exhaustively.
//!
//! # Who hears what
//!
//! | fact | notification | recipients |
//! | --- | --- | --- |
//! | `settled` | [`AgentSessionSettledMetadata`] | the session's audience: owner plus everyone who has driven it |
//! | `waiting_for_input` | [`AgentSessionWaitingForInputMetadata`] | the same audience - anyone with edit access may answer, and these are the people already driving it |
//! | `mentioned` | [`AgentSessionMentionedMetadata`] | the users the prompt named, who can now open the session |
//!
//! Everything else is nobody's news. Retracting a notification once it is
//! stale (the question answered, the next turn started) is deliberately not
//! done yet: the notification ingress has no producer-facing way to mark
//! done, and adding one is its own change.
//!
//! # Ids
//!
//! A notification's id is derived from what it is about - the session, the
//! turn (or prompt), and the kind - not from the event that carried it. The
//! notification service creates idempotently on id, so publishing the same
//! fact twice is a no-op, and a later retraction can name the notification
//! without looking anything up.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use agent_session::domain::events::{
    AgentSessionLifecycleEvent, SessionIdentity, SessionMentionedMetadata, SessionSettledMetadata,
    WaitingForInputMetadata,
};
use agent_session::domain::model::TurnId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::{Entity, EntityType};
use model_notifications::{
    AgentSessionMentionedMetadata, AgentSessionNotificationRef, AgentSessionSettledMetadata,
    AgentSessionWaitingForInputMetadata,
};
use notification::domain::models::apple::PushNotificationData;
use notification::domain::models::request::SendNotificationRequestBuilder;
use notification::domain::models::{Notification, SendNotificationRequest};

/// The namespace agent-session notification ids are derived in. Fixed
/// forever: changing it would orphan every retraction of a notification
/// created before the change.
const NOTIFICATION_ID_NAMESPACE: Uuid = Uuid::from_u128(0x6d61_6372_6f2d_6167_656e_742d_6e6f_7469);

/// One notification to create: everything the ingress request is built from,
/// in the open, so a test can look at it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notify<Metadata> {
    /// The notification's id; see the module docs.
    pub notification_id: Uuid,
    /// What the notification is about, for the inbox and for unsubscribes:
    /// always the session.
    pub entity: Entity<'static>,
    /// Unused for agent sessions; kept so the request shape stays uniform.
    pub secondary_entity: Option<Entity<'static>>,
    /// Who is told.
    pub recipients: Vec<MacroUserIdStr<'static>>,
    /// The kind-specific payload.
    pub metadata: Metadata,
}

impl<Metadata> Notify<Metadata>
where
    Metadata: Notification
        + notification::domain::models::NotificationExtIos<NotifData = PushNotificationData>,
{
    /// The ingress request: realtime for the browser, push for the phone.
    /// No sender: a bot is not a user, so nobody is filtered as their own
    /// sender and the kind's own title names the bot.
    #[must_use]
    pub fn into_request(self) -> SendNotificationRequest<'static, Metadata, PushNotificationData> {
        SendNotificationRequestBuilder {
            notification_entity: self.entity,
            secondary_notification_entity: self.secondary_entity,
            notification: self.metadata,
            sender_id: None,
            recipient_ids: self.recipients.into_iter().collect::<HashSet<_>>(),
        }
        .into_request_with_id(self.notification_id)
        .with_apns()
        .with_conn_gateway()
    }
}

/// One notification to send, planned from a fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannedNotification {
    /// Tell the audience the agent finished.
    Settled(Notify<AgentSessionSettledMetadata>),
    /// Tell the session's audience the agent is waiting on an answer.
    WaitingForInput(Notify<AgentSessionWaitingForInputMetadata>),
    /// Tell the people a prompt named.
    Mentioned(Notify<AgentSessionMentionedMetadata>),
}

impl PlannedNotification {
    /// The kind's wire name, for logs.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Settled(_) => AgentSessionSettledMetadata::TYPE_NAME,
            Self::WaitingForInput(_) => AgentSessionWaitingForInputMetadata::TYPE_NAME,
            Self::Mentioned(_) => AgentSessionMentionedMetadata::TYPE_NAME,
        }
    }
}

/// The notifications one lifecycle fact warrants.
#[must_use]
pub fn plan(event: &AgentSessionLifecycleEvent) -> Vec<PlannedNotification> {
    match event {
        AgentSessionLifecycleEvent::Settled(settled) => plan_settled(settled),
        AgentSessionLifecycleEvent::WaitingForInput(waiting) => plan_waiting(waiting),
        AgentSessionLifecycleEvent::Mentioned(mentioned) => plan_mentioned(mentioned),
        AgentSessionLifecycleEvent::Opened(_)
        | AgentSessionLifecycleEvent::TurnStarted(_)
        | AgentSessionLifecycleEvent::TurnEnded(_)
        | AgentSessionLifecycleEvent::InputReceived(_)
        | AgentSessionLifecycleEvent::Stopped(_)
        | AgentSessionLifecycleEvent::Renamed(_)
        | AgentSessionLifecycleEvent::Deleted(_) => Vec::new(),
    }
}

fn plan_settled(settled: &SessionSettledMetadata) -> Vec<PlannedNotification> {
    // "Settled" without the turn's record is a fact nobody can act on: no
    // excerpt, no chip, no turn to key the id by.
    let Some(turn) = &settled.last_turn else {
        return Vec::new();
    };
    let (entity, secondary_entity) = entities(&settled.identity);
    vec![PlannedNotification::Settled(Notify {
        notification_id: settled_notification_id(settled.identity.session_id.as_uuid(), turn.turn),
        entity,
        secondary_entity,
        recipients: audience(&settled.identity),
        metadata: AgentSessionSettledMetadata {
            session: session_ref(&settled.identity, turn.announcement_message_id),
            turn: turn.turn.0,
            actor: turn.actor.clone(),
            stop_reason: turn.stop_reason.clone(),
            excerpt: turn.excerpt.clone(),
        },
    })]
}

fn plan_waiting(waiting: &WaitingForInputMetadata) -> Vec<PlannedNotification> {
    let (entity, secondary_entity) = entities(&waiting.identity);
    vec![PlannedNotification::WaitingForInput(Notify {
        notification_id: waiting_notification_id(
            waiting.identity.session_id.as_uuid(),
            waiting.turn,
        ),
        entity,
        secondary_entity,
        // Anyone with edit access may answer; the people who have driven the
        // session are the ones to ask.
        recipients: audience(&waiting.identity),
        metadata: AgentSessionWaitingForInputMetadata {
            session: session_ref(&waiting.identity, waiting.announcement_message_id),
            turn: waiting.turn.0,
            question: waiting.question.clone(),
        },
    })]
}

fn plan_mentioned(mentioned: &SessionMentionedMetadata) -> Vec<PlannedNotification> {
    if mentioned.mentioned.is_empty() {
        return Vec::new();
    }
    let (entity, secondary_entity) = entities(&mentioned.identity);
    vec![PlannedNotification::Mentioned(Notify {
        notification_id: mentioned_notification_id(
            mentioned.identity.session_id.as_uuid(),
            mentioned.action_id.as_uuid(),
        ),
        entity,
        secondary_entity,
        recipients: dedup(mentioned.mentioned.iter().cloned()),
        metadata: AgentSessionMentionedMetadata {
            session: session_ref(&mentioned.identity, None),
            mentioned_by: mentioned.mentioned_by.clone(),
            action_id: mentioned.action_id.as_uuid(),
        },
    })]
}

/// What the notification is filed under: the session itself. That is what a
/// click opens, what the inbox hydrates as a row, and what a user mutes to
/// stop hearing about one run. The thread the chip lives in, when there is
/// one, rides in the metadata for surfaces that want it.
fn entities(identity: &SessionIdentity) -> (Entity<'static>, Option<Entity<'static>>) {
    (
        EntityType::AgentSession.with_entity_string(identity.session_id.to_string()),
        None,
    )
}

fn session_ref(
    identity: &SessionIdentity,
    announcement_message_id: Option<Uuid>,
) -> AgentSessionNotificationRef {
    AgentSessionNotificationRef {
        session_id: identity.session_id.as_uuid(),
        session_name: identity.session_name.clone(),
        bot_id: identity.bot_id.as_uuid(),
        bot_name: identity.bot_name.clone(),
        channel_id: identity.origin.as_ref().map(|origin| origin.channel_id),
        thread_id: identity.origin.as_ref().map(|origin| origin.thread_id),
        announcement_message_id,
    }
}

/// The session's audience, owner first, never empty: an event published
/// before the audience existed still reaches the owner.
fn audience(identity: &SessionIdentity) -> Vec<MacroUserIdStr<'static>> {
    dedup(std::iter::once(identity.owner_id.clone()).chain(identity.audience.iter().cloned()))
}

fn dedup(users: impl Iterator<Item = MacroUserIdStr<'static>>) -> Vec<MacroUserIdStr<'static>> {
    let mut seen = HashSet::new();
    users.filter(|user| seen.insert(user.clone())).collect()
}

fn derived_id(name: &str) -> Uuid {
    Uuid::new_v5(&NOTIFICATION_ID_NAMESPACE, name.as_bytes())
}

/// The id of the "finished" notification for one turn of one session.
#[must_use]
pub fn settled_notification_id(session_id: Uuid, turn: TurnId) -> Uuid {
    derived_id(&format!(
        "{session_id}:{}:{}",
        turn.0,
        AgentSessionSettledMetadata::TYPE_NAME
    ))
}

/// The id of the "needs an answer" notification for one turn of one session.
#[must_use]
pub fn waiting_notification_id(session_id: Uuid, turn: TurnId) -> Uuid {
    derived_id(&format!(
        "{session_id}:{}:{}",
        turn.0,
        AgentSessionWaitingForInputMetadata::TYPE_NAME
    ))
}

/// The id of the "mentioned you" notification for one prompt to one session.
#[must_use]
pub fn mentioned_notification_id(session_id: Uuid, action_id: Uuid) -> Uuid {
    derived_id(&format!(
        "{session_id}:{action_id}:{}",
        AgentSessionMentionedMetadata::TYPE_NAME
    ))
}
