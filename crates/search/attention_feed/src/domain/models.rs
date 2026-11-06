//! Shared feed models: viewers, keys, tokens, candidates and acknowledgment.

use std::{str::FromStr, sync::Arc};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use model_notifications::NotifEvent;
use notification::domain::models::{NotificationState, UserNotificationRow};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A notification row as feeds read it.
pub type FeedNotification = Arc<UserNotificationRow<NotifEvent>>;

/// The caller a feed request is evaluated for.
#[derive(Debug, Clone)]
pub struct FeedViewer {
    /// The authenticated user.
    pub user: MacroUserIdStr<'static>,
    /// The user's team membership, when they have one; foreign entities
    /// stored for the team and CRM records are visible through it.
    pub team: Option<EntityAccessReceipt<MemberTeamRole>>,
}

/// Stable per-viewer identity of a feed entry: the entity its candidate is
/// keyed on.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FeedKey(Entity<'static>);

/// A feed key id that does not name an entity.
#[derive(Debug, thiserror::Error)]
#[error("invalid feed key")]
pub struct InvalidFeedKey;

impl FeedKey {
    /// The key for `entity`.
    pub fn new(entity: Entity<'static>) -> Self {
        Self(entity)
    }

    /// The entity the key names.
    pub fn entity(&self) -> &Entity<'static> {
        &self.0
    }

    /// Consume the key, returning its entity.
    pub fn into_entity(self) -> Entity<'static> {
        self.0
    }

    /// The key's global id: `<entity type>:<entity id>`.
    pub fn id(&self) -> String {
        format!("{}:{}", self.0.entity_type, self.0.entity_id)
    }

    /// Parse an id produced by [`Self::id`].
    pub fn parse(id: &str) -> Result<Self, InvalidFeedKey> {
        let (entity_type, entity_id) = id.split_once(':').ok_or(InvalidFeedKey)?;
        if entity_id.is_empty() {
            return Err(InvalidFeedKey);
        }
        let entity_type = EntityType::from_str(entity_type).map_err(|_| InvalidFeedKey)?;
        Ok(Self(entity_type.with_entity_string(entity_id.to_string())))
    }
}

/// How a feed keys the notifications that place its candidates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CandidateKeying {
    /// A notification about a channel thread (a reply, a mention, a
    /// reaction or a document mention, which name a thread root) keys to a
    /// `channel_message` candidate on that root; every other notification
    /// keys to the entity it is filed under. Home's work feed.
    ThreadScoped,
    /// Every notification keys to the entity it is filed under, so a
    /// channel's notifications, its threads' included, place one candidate.
    FiledEntity,
}

/// The attention one entry acknowledges. Done acknowledges only what was
/// observed, so a notification arriving later keeps the entry active.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct FeedRevision {
    /// The newest notification observed.
    #[serde(rename = "a", default, skip_serializing_if = "Option::is_none")]
    pub attention_through: Option<DateTime<Utc>>,
}

/// A revision token that does not decode.
#[derive(Debug, thiserror::Error)]
#[error("invalid feed revision")]
pub struct InvalidFeedRevision;

impl FeedRevision {
    /// The revision covering `notifications`: their newest creation time.
    pub fn covering<'a>(notifications: impl IntoIterator<Item = &'a FeedNotification>) -> Self {
        Self {
            attention_through: notifications
                .into_iter()
                .map(|notification| notification.created_at)
                .max(),
        }
    }

    /// The ids of `notifications` this revision acknowledges, in order.
    pub fn acknowledged<'a>(
        &self,
        notifications: impl IntoIterator<Item = &'a FeedNotification>,
    ) -> Vec<Uuid> {
        let Some(through) = self.attention_through else {
            return Vec::new();
        };
        notifications
            .into_iter()
            .filter(|notification| notification.created_at <= through)
            .map(|notification| notification.notification_id)
            .collect()
    }

    /// The opaque token clients echo back.
    pub fn encode(&self) -> String {
        encode_token(self)
    }

    /// Decode a token produced by [`Self::encode`].
    pub fn decode(token: &str) -> Result<Self, InvalidFeedRevision> {
        decode_token(token).ok_or(InvalidFeedRevision)
    }
}

/// Where the next page of a feed starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedPosition {
    /// The last walked candidate's sort time.
    #[serde(rename = "s")]
    pub sort_at: DateTime<Utc>,
    /// The last walked candidate's entity id.
    #[serde(rename = "i")]
    pub entity_id: String,
}

/// A cursor that does not decode.
#[derive(Debug, thiserror::Error)]
#[error("invalid feed cursor")]
pub struct InvalidFeedCursor;

impl FeedPosition {
    /// The opaque cursor clients send back for the next page.
    pub fn encode(&self) -> String {
        encode_token(self)
    }

    /// Decode a cursor produced by [`Self::encode`].
    pub fn decode(cursor: &str) -> Result<Self, InvalidFeedCursor> {
        decode_token(cursor).ok_or(InvalidFeedCursor)
    }
}

/// Facts about a candidate's entity that scoping and state depend on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EntityFacts {
    /// For a channel thread, the channel whose notifications it shares.
    pub thread_channel: Option<Uuid>,
    /// For an email thread, its mailbox state.
    pub mail: Option<MailFacts>,
}

/// An email thread's mailbox state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailFacts {
    /// The thread is in the inbox (not archived).
    pub inbox_visible: bool,
    /// The thread has no unread mail.
    pub is_read: bool,
}

/// A request for one page of hydrated, authorized candidates.
#[derive(Debug, Clone)]
pub struct CandidateRequest {
    /// Who the feed is for.
    pub viewer: FeedViewer,
    /// How notifications key to candidates.
    pub keying: CandidateKeying,
    /// Whether the viewer's own work admits candidates besides attention.
    pub own_work: bool,
    /// Candidate entity types to include.
    pub types: Vec<EntityType>,
    /// The feed's membership filter, applied by the source's access gates
    /// and hydration.
    pub filter: EntityFilterAst,
    /// Maximum candidates to return.
    pub limit: u16,
    /// Resume after this position; `None` for the first page.
    pub after: Option<FeedPosition>,
    /// Restrict to these candidate keys, for recomputing known entries.
    pub only: Option<Vec<Entity<'static>>>,
}

/// One hydrated, authorized candidate.
#[derive(Debug, Clone)]
pub struct Candidate<E> {
    /// The candidate key.
    pub key: Entity<'static>,
    /// The hydrated entity.
    pub entity: E,
    /// Facts used for scoping and state.
    pub facts: EntityFacts,
    /// The candidate's live attention time, when it has any.
    pub attention_at: Option<DateTime<Utc>>,
    /// The viewer's own-work time, when it has any.
    pub touched_at: Option<DateTime<Utc>>,
    /// Where the candidate sits in the feed.
    pub sort_at: DateTime<Utc>,
}

/// One page of hydrated candidates.
#[derive(Debug)]
pub struct CandidatePage<E> {
    /// The page's candidates, newest first.
    pub items: Vec<Candidate<E>>,
    /// Where the next page starts; `None` once the feed is exhausted.
    pub next: Option<FeedPosition>,
}

/// A candidate with the viewer's active notifications its scope reads from:
/// its own entity's, or for a thread-scoped channel thread its channel's.
#[derive(Debug, Clone)]
pub struct Loaded<E> {
    /// The candidate.
    pub candidate: Candidate<E>,
    /// The active (unseen or seen) notifications, newest first.
    pub notifications: Vec<FeedNotification>,
}

/// One page of a feed's own entries.
#[derive(Debug)]
pub struct FeedPage<T> {
    /// The entries, in feed order.
    pub entries: Vec<T>,
    /// Where the next page starts; `None` once the feed is exhausted.
    pub next: Option<FeedPosition>,
}

/// What completing one entry, or part of one, changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Acknowledgment {
    /// The entry the notifications belong to.
    pub key: FeedKey,
    /// The viewer's notifications to move to done.
    pub notification_ids: Vec<Uuid>,
    /// An inbox email thread to archive, mail's own done.
    pub archive_thread: Option<Uuid>,
}

/// Everything one acknowledgment changed, so undo can reverse exactly those
/// effects and nothing that happened since.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DoneReceipt {
    /// The ids of the keys the operation touched.
    #[serde(rename = "k")]
    pub keys: Vec<String>,
    /// Notifications this operation moved to done.
    #[serde(rename = "n", default)]
    pub notification_ids: Vec<Uuid>,
    /// Email threads this operation archived.
    #[serde(rename = "e", default)]
    pub archived_threads: Vec<Uuid>,
}

/// An undo token that does not decode.
#[derive(Debug, thiserror::Error)]
#[error("invalid undo token")]
pub struct InvalidUndoToken;

impl DoneReceipt {
    /// The opaque undo token returned to the caller.
    pub fn encode(&self) -> String {
        encode_token(self)
    }

    /// Decode a token produced by [`Self::encode`].
    pub fn decode(token: &str) -> Result<Self, InvalidUndoToken> {
        decode_token(token).ok_or(InvalidUndoToken)
    }

    /// The keys this receipt touched.
    pub fn feed_keys(&self) -> Vec<FeedKey> {
        self.keys
            .iter()
            .filter_map(|id| FeedKey::parse(id).ok())
            .collect()
    }
}

/// A change that may affect one viewer's entries, from any realtime source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedTrigger {
    /// These candidate keys may have changed.
    Changed(Vec<Entity<'static>>),
    /// Changes may have been missed; mounted feeds must refetch.
    Invalidated,
}

/// The triggers collected for one recompute.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct LiveBatch {
    /// Keys to recompute, in arrival order, each once.
    pub keys: Vec<FeedKey>,
    /// Whether any trigger said changes may have been missed.
    pub invalidated: bool,
}

/// Errors returned by feed services.
#[derive(Debug, thiserror::Error)]
pub enum FeedError {
    /// The caller sent an invalid cursor, revision, id or undo token.
    #[error("{0}")]
    InvalidInput(&'static str),
    /// A dependency failed.
    #[error("the feed is unavailable: {0}")]
    Unavailable(rootcause::Report),
}

impl From<rootcause::Report> for FeedError {
    fn from(report: rootcause::Report) -> Self {
        Self::Unavailable(report)
    }
}

/// Whether a notification makes its entry unread. Channel events other than
/// messages, mentions and reactions (invites, calls) never do.
pub fn counts_as_unseen(notification: &UserNotificationRow<NotifEvent>) -> bool {
    if notification.state != NotificationState::Unseen {
        return false;
    }
    if notification.entity.entity_type != EntityType::Channel {
        return true;
    }
    matches!(
        notification.notification_metadata,
        NotifEvent::ChannelMention(_)
            | NotifEvent::ChannelMessageSend(_)
            | NotifEvent::ChannelMessageReaction(_)
            | NotifEvent::ChannelMessageReply(_)
            | NotifEvent::DocumentMention(_)
    )
}

/// Sort notifications newest first, breaking ties by id for a stable order.
pub fn sort_newest_first(notifications: &mut [FeedNotification]) {
    notifications.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.notification_id.cmp(&a.notification_id))
    });
}

fn encode_token<T: Serialize>(value: &T) -> String {
    let json = serde_json::to_vec(value).expect("feed tokens serialize");
    URL_SAFE_NO_PAD.encode(json)
}

fn decode_token<T: for<'de> Deserialize<'de>>(token: &str) -> Option<T> {
    let json = URL_SAFE_NO_PAD.decode(token).ok()?;
    serde_json::from_slice(&json).ok()
}
