//! Notification fixtures and port fakes for tests of feeds built on this
//! layer. Fakes share their state through `Arc`s, so a test keeps a clone to
//! inspect after handing one to a service.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::{DateTime, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::{NotificationState, UserNotificationRow};
use rootcause::Report;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::domain::{
    models::{
        Candidate, CandidatePage, CandidateRequest, EntityFacts, FeedNotification, FeedPosition,
        FeedViewer, MailFacts,
    },
    ports::{CandidateSource, FeedMail, FeedNotifications, FeedSignals, NotificationTransition},
};

/// The viewer every fixture belongs to.
pub const USER: &str = "macro|viewer@example.com";

/// A minute past 10:00 on 2024-06-01, UTC.
pub fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2024, 6, 1, 10, minute, 0).unwrap()
}

/// [`USER`]'s id.
pub fn viewer_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap()
}

/// [`USER`] without a team.
pub fn viewer() -> FeedViewer {
    FeedViewer {
        user: viewer_id(),
        team: None,
    }
}

/// A deterministic id.
pub fn uuid(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

/// An entity with a deterministic id.
pub fn entity(entity_type: EntityType, id: u128) -> Entity<'static> {
    entity_type.with_entity_string(uuid(id).to_string())
}

/// A notification with typed metadata decoded from `tag`/`content`, the way
/// stored rows are.
pub fn notification(
    id: u128,
    entity: Entity<'static>,
    tag: &str,
    content: Value,
    minute: u32,
    state: NotificationState,
) -> FeedNotification {
    let metadata: NotifEvent = serde_json::from_value(json!({ "tag": tag, "content": content }))
        .unwrap_or_else(|error| panic!("invalid {tag} fixture: {error}"));
    Arc::new(UserNotificationRow {
        owner_id: viewer_id(),
        notification_id: uuid(id),
        notification_event_type: tag.to_string(),
        entity,
        sent: true,
        state,
        created_at: at(minute),
        viewed_at: None,
        updated_at: at(minute),
        deleted_at: None,
        notification_metadata: metadata,
        sender_id: None,
    })
}

/// A new root message in a channel.
pub fn channel_send(id: u128, channel: u128, message: u128, minute: u32) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_message_send",
        json!({ "messageId": uuid(message), "messageContent": "hi", "channelType": "public" }),
        minute,
        NotificationState::Unseen,
    )
}

/// A reply in a channel thread.
pub fn channel_reply(
    id: u128,
    channel: u128,
    thread: u128,
    message: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_message_reply",
        json!({
            "threadId": uuid(thread),
            "messageId": uuid(message),
            "messageContent": "re",
            "channelType": "public",
        }),
        minute,
        NotificationState::Unseen,
    )
}

/// A channel mention, in a thread when `thread` is given.
pub fn channel_mention(
    id: u128,
    channel: u128,
    message: u128,
    thread: Option<u128>,
    minute: u32,
) -> FeedNotification {
    let mut content = json!({
        "messageId": uuid(message),
        "messageContent": "@you",
        "channelType": "public",
    });
    if let Some(thread) = thread {
        content["threadId"] = json!(uuid(thread));
    }
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_mention",
        content,
        minute,
        NotificationState::Unseen,
    )
}

/// A reaction to the viewer's channel message, in a thread when `thread` is
/// given.
pub fn channel_reaction(
    id: u128,
    channel: u128,
    message: u128,
    thread: Option<u128>,
    minute: u32,
) -> FeedNotification {
    let mut content = json!({
        "messageId": uuid(message),
        "messageContent": "nice",
        "emoji": "+1",
        "channelType": "public",
    });
    if let Some(thread) = thread {
        content["threadId"] = json!(uuid(thread));
    }
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_message_reaction",
        content,
        minute,
        NotificationState::Unseen,
    )
}

/// An invitation to a channel.
pub fn channel_invite(id: u128, channel: u128, minute: u32) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Channel, channel),
        "channel_invite",
        json!({ "invitedBy": USER, "channelType": "public" }),
        minute,
        NotificationState::Unseen,
    )
}

fn comment_content(comment: u128, thread: u128) -> Value {
    json!({
        "documentName": "Doc",
        "owner": USER,
        "commentId": uuid(comment),
        "threadId": uuid(thread),
        "text": "comment",
    })
}

/// A comment on a document; a root comment when `comment == thread`.
pub fn doc_comment(
    id: u128,
    document: u128,
    comment: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Document, document),
        "commented_on_document",
        comment_content(comment, thread),
        minute,
        NotificationState::Unseen,
    )
}

/// A reply in a document comment thread.
pub fn doc_reply(
    id: u128,
    document: u128,
    comment: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Document, document),
        "replied_to_document_comment_thread",
        comment_content(comment, thread),
        minute,
        NotificationState::Unseen,
    )
}

/// A mention in a document comment.
pub fn doc_comment_mention(
    id: u128,
    document: u128,
    comment: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    let mut content = comment_content(comment, thread);
    content["mentionId"] = json!("mention");
    notification(
        id,
        entity(EntityType::Document, document),
        "mentioned_in_document_comment",
        content,
        minute,
        NotificationState::Unseen,
    )
}

/// A reminder about `entity`.
pub fn reminder(id: u128, entity: Entity<'static>, minute: u32) -> FeedNotification {
    notification(
        id,
        entity,
        "reminder",
        json!({ "reminderId": uuid(id), "description": "follow up" }),
        minute,
        NotificationState::Unseen,
    )
}

/// New mail on an email thread.
pub fn new_email(
    id: u128,
    thread: u128,
    minute: u32,
    state: NotificationState,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::EmailThread, thread),
        "new_email",
        json!({
            "toEmail": "viewer@example.com",
            "threadId": uuid(thread),
            "subject": "Hello",
            "snippet": "...",
        }),
        minute,
        state,
    )
}

/// The same notification in another state.
pub fn with_state(notification: &FeedNotification, state: NotificationState) -> FeedNotification {
    let mut row = (**notification).clone();
    row.state = state;
    Arc::new(row)
}

/// The notifications' ids, in order.
pub fn ids(notifications: &[FeedNotification]) -> Vec<Uuid> {
    notifications.iter().map(|n| n.notification_id).collect()
}

/// A candidate carrying `entity`, sorted at the later of its times.
pub fn candidate<E>(
    entity: E,
    key: Entity<'static>,
    attention: Option<u32>,
    touched: Option<u32>,
) -> Candidate<E> {
    let attention_at = attention.map(at);
    let touched_at = touched.map(at);
    Candidate {
        key,
        entity,
        facts: EntityFacts::default(),
        attention_at,
        touched_at,
        sort_at: attention_at
            .max(touched_at)
            .expect("a candidate has a reason"),
    }
}

/// An email thread candidate in the given mailbox state.
pub fn mail_candidate<E>(
    entity: E,
    thread: u128,
    attention: Option<u32>,
    touched: Option<u32>,
    mail: MailFacts,
) -> Candidate<E> {
    let mut candidate = candidate(
        entity,
        self::entity(EntityType::EmailThread, thread),
        attention,
        touched,
    );
    candidate.facts.mail = Some(mail);
    candidate
}

/// Serves a fixed list of candidates in feed order, narrowed by each
/// request's `only` keys, cursor and limit, and records every request.
pub struct FakeSource<E> {
    /// The candidates, newest first.
    pub items: Arc<Mutex<Vec<Candidate<E>>>>,
    /// Every request received, in order.
    pub requests: Arc<Mutex<Vec<CandidateRequest>>>,
}

impl<E> Clone for FakeSource<E> {
    fn clone(&self) -> Self {
        Self {
            items: Arc::clone(&self.items),
            requests: Arc::clone(&self.requests),
        }
    }
}

impl<E> FakeSource<E> {
    /// A source serving `items`, newest first.
    pub fn with(items: Vec<Candidate<E>>) -> Self {
        Self {
            items: Arc::new(Mutex::new(items)),
            requests: Arc::default(),
        }
    }
}

impl<E> CandidateSource for FakeSource<E>
where
    E: Clone + Send + Sync + 'static,
{
    type Entity = E;

    async fn page(&self, request: CandidateRequest) -> Result<CandidatePage<E>, Report> {
        self.requests.lock().unwrap().push(request.clone());
        let items = self.items.lock().unwrap().clone();
        let mut page: Vec<_> = items
            .into_iter()
            .filter(|item| {
                request
                    .only
                    .as_ref()
                    .is_none_or(|only| only.contains(&item.key))
            })
            .filter(|item| {
                request.after.as_ref().is_none_or(|after| {
                    (item.sort_at, item.key.entity_id.to_string())
                        < (after.sort_at, after.entity_id.clone())
                })
            })
            .collect();
        let full = page.len() > usize::from(request.limit);
        page.truncate(usize::from(request.limit));
        let next = full.then(|| {
            let last = page.last().expect("a full page has a last item");
            FeedPosition {
                sort_at: last.sort_at,
                entity_id: last.key.entity_id.to_string(),
            }
        });
        Ok(CandidatePage { items: page, next })
    }
}

/// One requested transition: the ids and the state they move to.
pub type RecordedTransition = (Vec<Uuid>, NotificationTransition);

/// Holds the viewer's notifications in memory, applies transitions to them,
/// and records loads and transitions.
#[derive(Clone, Default)]
pub struct FakeNotifications {
    /// Every notification, by the entity it is filed under.
    pub by_entity: Arc<Mutex<HashMap<Entity<'static>, Vec<FeedNotification>>>>,
    /// The entities each `active` call asked for.
    pub loads: Arc<Mutex<Vec<Vec<Entity<'static>>>>>,
    /// Every transition requested.
    pub transitions: Arc<Mutex<Vec<RecordedTransition>>>,
}

impl FakeNotifications {
    /// A store holding `notifications`.
    pub fn with(notifications: Vec<FeedNotification>) -> Self {
        let mut by_entity: HashMap<Entity<'static>, Vec<FeedNotification>> = HashMap::new();
        for notification in notifications {
            by_entity
                .entry(notification.entity.clone())
                .or_default()
                .push(notification);
        }
        Self {
            by_entity: Arc::new(Mutex::new(by_entity)),
            ..Default::default()
        }
    }

    /// The current state of notification `id`.
    pub fn state_of(&self, id: Uuid) -> NotificationState {
        self.by_entity
            .lock()
            .unwrap()
            .values()
            .flatten()
            .find(|n| n.notification_id == id)
            .map(|n| n.state)
            .expect("the notification exists")
    }
}

impl FeedNotifications for FakeNotifications {
    async fn active(
        &self,
        _user: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Vec<FeedNotification>>, Report> {
        self.loads.lock().unwrap().push(entities.clone());
        let by_entity = self.by_entity.lock().unwrap();
        Ok(entities
            .into_iter()
            .map(|entity| {
                let active = by_entity
                    .get(&entity)
                    .into_iter()
                    .flatten()
                    .filter(|n| n.state != NotificationState::Done)
                    .cloned()
                    .collect();
                (entity, active)
            })
            .collect())
    }

    async fn transition(
        &self,
        _user: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        transition: NotificationTransition,
    ) -> Result<Vec<Uuid>, Report> {
        self.transitions
            .lock()
            .unwrap()
            .push((notification_ids.clone(), transition));
        let mut by_entity = self.by_entity.lock().unwrap();
        let mut changed = Vec::new();
        for id in notification_ids {
            let Some(notification) = by_entity
                .values_mut()
                .flatten()
                .find(|notification| notification.notification_id == id)
            else {
                continue;
            };
            let state = match (transition, notification.state) {
                // Seen never reopens a done notification.
                (NotificationTransition::Seen, NotificationState::Unseen) => {
                    NotificationState::Seen
                }
                (NotificationTransition::Seen, _) => continue,
                (NotificationTransition::Done, _) => NotificationState::Done,
                (NotificationTransition::Undone, _) => NotificationState::Seen,
            };
            *notification = with_state(notification, state);
            changed.push(id);
        }
        Ok(changed)
    }
}

/// Records archive and unarchive calls.
#[derive(Clone, Default)]
pub struct FakeMail {
    /// Every `(thread, archived)` call, in order.
    pub calls: Arc<Mutex<Vec<(Uuid, bool)>>>,
}

impl FeedMail for FakeMail {
    async fn set_archived(
        &self,
        _user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        archived: bool,
    ) -> Result<(), Report> {
        self.calls.lock().unwrap().push((thread_id, archived));
        Ok(())
    }
}

/// Records change signals.
#[derive(Clone, Default)]
pub struct FakeSignals {
    /// The entities of every signal, in order.
    pub calls: Arc<Mutex<Vec<Vec<Entity<'static>>>>>,
}

impl FeedSignals for FakeSignals {
    async fn changed(&self, _user: MacroUserIdStr<'static>, entities: Vec<Entity<'static>>) {
        self.calls.lock().unwrap().push(entities);
    }
}
