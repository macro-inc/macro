//! Cacheable channel messages and embedded timeline/thread values.
use async_graphql::{Enum, ID, Json, SimpleObject, Union};
use chrono::{DateTime, SecondsFormat, Utc};
use messages::domain::{models::*, ports::*};
use uuid::Uuid;

use crate::inputs::{encode_cursor, encode_reply_cursor};

/// Renderable channel message kind.
#[derive(Clone, Copy, Debug, Enum, Eq, PartialEq)]
pub enum GraphqlChannelMessageKind {
    /// A message authored by a person, guest, or bot.
    Message,
    /// A channel call's persistent discussion root.
    CallRoot,
}

/// Public bot identity associated with a message.
#[derive(SimpleObject)]
pub struct GraphqlChannelBotProfile {
    /// Bot display name.
    pub name: String,
    /// Optional bot avatar URL.
    pub avatar_url: Option<String>,
}

/// Entity mentioned by a message.
#[derive(SimpleObject)]
pub struct GraphqlChannelMention {
    /// Mentioned entity kind.
    pub entity_type: String,
    /// Mentioned entity reference.
    pub entity_id: String,
}

/// Entity attached to a message.
#[derive(SimpleObject)]
pub struct GraphqlChannelAttachment {
    /// Attachment identity; this object is embedded in its message.
    pub attachment_id: ID,
    /// Attached entity kind.
    pub entity_type: String,
    /// Attached entity reference.
    pub entity_id: String,
    /// Media width in pixels, when known.
    pub width: Option<i32>,
    /// Media height in pixels, when known.
    pub height: Option<i32>,
    /// Attachment creation time, retaining stored microseconds.
    pub created_at: String,
}

/// A reaction and the users who applied it.
#[derive(SimpleObject)]
pub struct GraphqlChannelReaction {
    /// Reaction emoji.
    pub emoji: String,
    /// User references in the same order as REST.
    pub users: Vec<String>,
}

/// Current lifecycle of a channel call.
#[derive(Clone, Copy, Debug, Enum, Eq, PartialEq)]
pub enum GraphqlChannelCallState {
    /// Call is live.
    Live,
    /// Call has ended.
    Ended,
    /// The call record was removed but its discussion remains.
    RecordDeleted,
}

/// Call lifecycle embedded in a call-root message.
#[derive(SimpleObject)]
pub struct GraphqlChannelCallStatus {
    /// Current lifecycle state.
    pub state: GraphqlChannelCallState,
    /// End time, retaining stored microseconds.
    pub ended_at: Option<String>,
    /// Duration in milliseconds when the call has ended.
    pub duration_ms: Option<f64>,
}

/// Thread state and the oldest three live replies, embedded in its root.
#[derive(SimpleObject)]
pub struct GraphqlChannelThread {
    /// Whether the discussion has been resolved.
    pub resolved: bool,
    /// Whole-thread deletion time.
    pub deleted_at: Option<String>,
    /// Thread creation time.
    pub created_at: String,
    /// Last thread state update time.
    pub updated_at: String,
    /// Thread owner's user reference.
    pub user_id: String,
    /// Number of live replies.
    pub reply_count: i64,
    /// Latest live reply creation time.
    pub latest_reply_at: Option<String>,
    /// Oldest three live replies in server display order.
    pub preview: Vec<GraphqlChannelMessage>,
}

/// Canonical channel message, shared by pages, item reads, and change replay.
#[derive(SimpleObject)]
pub struct GraphqlChannelMessage {
    /// Globally unique message identity.
    pub id: ID,
    /// Channel containing the message.
    pub channel_id: ID,
    /// Root message reference for replies; absent for roots.
    pub thread_id: Option<ID>,
    /// Message or channel call root.
    pub kind: GraphqlChannelMessageKind,
    /// Opaque position that compares bytewise in chronological display order.
    /// Stored times are post-epoch and import orders nonnegative; unexpected
    /// negative values clamp to zero when encoding.
    pub sort_key: String,
    /// Sender reference, including guest or bot senders.
    pub sender_id: String,
    /// Verified guest's display name.
    pub guest_name: Option<String>,
    /// Original author display name on imported messages.
    pub imported_author_name: Option<String>,
    /// Public bot identity on bot-authored messages.
    pub bot_profile: Option<GraphqlChannelBotProfile>,
    /// Entities mentioned in the message.
    pub mentions: Vec<GraphqlChannelMention>,
    /// User who triggered a bot message.
    pub triggered_by: Option<String>,
    /// Client through which the user triggered a bot message.
    pub triggered_via: Option<String>,
    /// Message body in Macro Markdown.
    pub content: String,
    /// Creation time, retaining stored microseconds.
    pub created_at: String,
    /// Last update time, retaining stored microseconds.
    pub updated_at: String,
    /// Last content edit time.
    pub edited_at: Option<String>,
    /// Message tombstone time, independent of whole-thread deletion.
    pub deleted_at: Option<String>,
    /// Attached entities in server order.
    pub attachments: Vec<GraphqlChannelAttachment>,
    /// Aggregated reactions in server order.
    pub reactions: Vec<GraphqlChannelReaction>,
    /// Thread state and bounded preview; present only on roots.
    pub thread: Option<GraphqlChannelThread>,
    /// Call lifecycle; present only on call roots.
    pub call: Option<GraphqlChannelCallStatus>,
}

impl GraphqlChannelMessage {
    /// Map an already-authorized domain message without additional reads.
    pub(crate) fn from_message(message: Message, channel_id: Uuid) -> Self {
        let cursor = MessageCursor {
            created_at: message.created_at,
            id: message.id,
        };
        let sort_key = if message.thread_id.is_some() {
            encode_reply_cursor(&MessageReplyCursor {
                import_order: message.import_order,
                created_at: message.created_at,
                id: message.id,
            })
        } else {
            encode_cursor(&cursor)
        };
        Self {
            id: ID(message.id.to_string()),
            channel_id: ID(channel_id.to_string()),
            thread_id: message.thread_id.map(|id| ID(id.to_string())),
            kind: match message.kind {
                MessageKind::Message => GraphqlChannelMessageKind::Message,
                MessageKind::CallRoot => GraphqlChannelMessageKind::CallRoot,
            },
            sort_key,
            sender_id: message.sender_id.as_ref().to_owned(),
            guest_name: message.guest_name,
            imported_author_name: message.imported_author.map(|author| author.name),
            bot_profile: message.bot_profile.map(|profile| GraphqlChannelBotProfile {
                name: profile.name,
                avatar_url: profile.avatar_url,
            }),
            mentions: message
                .mentions
                .into_iter()
                .map(|mention| GraphqlChannelMention {
                    entity_type: mention.entity_type,
                    entity_id: mention.entity_id,
                })
                .collect(),
            triggered_by: message.triggered_by,
            triggered_via: message.triggered_via,
            content: message.content,
            created_at: timestamp(message.created_at),
            updated_at: timestamp(message.updated_at),
            edited_at: message.edited_at.map(timestamp),
            deleted_at: message.deleted_at.map(timestamp),
            attachments: message
                .attachments
                .into_iter()
                .map(|a| GraphqlChannelAttachment {
                    attachment_id: ID(a.id.to_string()),
                    entity_type: a.entity_type,
                    entity_id: a.entity_id,
                    width: a.width,
                    height: a.height,
                    created_at: timestamp(a.created_at),
                })
                .collect(),
            reactions: message
                .reactions
                .into_iter()
                .map(|r| GraphqlChannelReaction {
                    emoji: r.emoji,
                    users: r.users,
                })
                .collect(),
            thread: None,
            call: None,
        }
    }

    /// Add the authoritative thread summary already hydrated by the domain.
    pub(crate) fn from_item(
        item: MessageListItem,
        channel_id: Uuid,
        call: Option<CallEntryStatus>,
    ) -> Self {
        let mut message = Self::from_message(item.message, channel_id);
        message.thread = Some(GraphqlChannelThread {
            resolved: item.state.resolved,
            deleted_at: item.state.deleted_at.map(timestamp),
            created_at: timestamp(item.state.created_at),
            updated_at: timestamp(item.state.updated_at),
            user_id: item.state.user_id,
            reply_count: item.thread.reply_count,
            latest_reply_at: item.thread.latest_reply_at.map(timestamp),
            preview: item
                .thread
                .preview
                .into_iter()
                .map(|reply| Self::from_message(reply, channel_id))
                .collect(),
        });
        message.call = call.map(Into::into);
        message
    }
}

impl From<CallEntryStatus> for GraphqlChannelCallStatus {
    fn from(status: CallEntryStatus) -> Self {
        let (state, ended_at, duration_ms) = match status {
            CallEntryStatus::Live => (GraphqlChannelCallState::Live, None, None),
            CallEntryStatus::RecordDeleted => (GraphqlChannelCallState::RecordDeleted, None, None),
            CallEntryStatus::Ended {
                ended_at,
                duration_ms,
            } => (
                GraphqlChannelCallState::Ended,
                Some(timestamp(ended_at)),
                Some(duration_ms as f64),
            ),
        };
        Self {
            state,
            ended_at,
            duration_ms,
        }
    }
}

/// Recorded channel activity displayed alongside message roots.
#[derive(SimpleObject)]
pub struct GraphqlChannelTimelineActivity {
    /// Globally unique activity identity.
    pub id: ID,
    /// Channel whose timeline contains the activity.
    pub channel_id: ID,
    /// Opaque chronological position shared with message roots.
    pub sort_key: String,
    /// Actor's user reference.
    pub actor_id: String,
    /// Activity time, retaining stored microseconds.
    pub occurred_at: String,
    /// Stored activity action tag.
    pub action: String,
    /// Stored activity payload.
    pub payload: Option<Json<serde_json::Value>>,
}

impl GraphqlChannelTimelineActivity {
    /// Preserve the same activity projection in timeline and change pages.
    pub(crate) fn from_activity(
        activity: activity::domain::timeline::TimelineActivity,
        channel_id: Uuid,
    ) -> Self {
        Self {
            id: ID(activity.id.to_string()),
            channel_id: ID(channel_id.to_string()),
            sort_key: encode_cursor(&MessageCursor {
                created_at: activity.occurred_at,
                id: activity.id,
            }),
            actor_id: activity.actor_id,
            occurred_at: timestamp(activity.occurred_at),
            action: activity.action,
            payload: activity.payload.map(Json),
        }
    }
}

/// A message root or recorded activity in a channel timeline.
#[derive(Union)]
pub enum GraphqlChannelTimelineEntry {
    /// A root message, including a call root.
    Message(Box<GraphqlChannelMessage>),
    /// A recorded channel activity.
    Activity(GraphqlChannelTimelineActivity),
}

impl GraphqlChannelTimelineEntry {
    /// Map a domain entry without changing its position or values.
    pub(crate) fn from_entry(entry: MessageTimelineEntry, channel_id: Uuid) -> Self {
        match entry {
            MessageTimelineEntry::Message { message } => Self::Message(Box::new(
                GraphqlChannelMessage::from_item(*message, channel_id, None),
            )),
            MessageTimelineEntry::Call { message, status } => Self::Message(Box::new(
                GraphqlChannelMessage::from_item(*message, channel_id, Some(status)),
            )),
            MessageTimelineEntry::Activity { activity } => Self::Activity(
                GraphqlChannelTimelineActivity::from_activity(activity, channel_id),
            ),
        }
    }
}

/// A newest-first page of the channel timeline.
#[derive(SimpleObject)]
pub struct GraphqlChannelTimelinePage {
    /// Roots and activity rows in exactly the server's display order.
    pub entries: Vec<GraphqlChannelTimelineEntry>,
    /// Position to pass as `before`; absent when there are no older entries.
    pub older_cursor: Option<String>,
    /// Position to pass as `after`; absent when there are no newer entries.
    pub newer_cursor: Option<String>,
    /// Channel change sequence read before this page.
    pub seq: String,
}

/// A bounded, oldest-first page of live thread replies.
#[derive(SimpleObject)]
pub struct GraphqlChannelThreadPage {
    /// Root message and its authoritative thread summary.
    pub root: GraphqlChannelMessage,
    /// Live replies in server display order.
    pub replies: Vec<GraphqlChannelMessage>,
    /// Position to pass as `before` to continue toward older replies.
    pub older_cursor: Option<String>,
    /// Position to pass as `after` to continue toward newer replies.
    pub newer_cursor: Option<String>,
    /// Channel change sequence read before this page.
    pub seq: String,
}

/// A bounded page of channel changes since a sequence.
#[derive(SimpleObject)]
pub struct GraphqlChannelChanges {
    /// Whether the client must discard its channel coverage and reload.
    pub reset_required: bool,
    /// Last sequence reached by this page, or current sequence on reset.
    pub seq: String,
    /// Whether another change page follows this sequence.
    pub has_more: bool,
    /// Current changed messages and affected roots, including tombstones.
    pub messages: Vec<GraphqlChannelMessage>,
    /// Recorded timeline activities referenced by this change page.
    pub activities: Vec<GraphqlChannelTimelineActivity>,
    /// References to logged entries that no longer exist.
    pub removed_ids: Vec<ID>,
}

/// Format timestamps without discarding persisted microseconds.
pub(crate) fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}
