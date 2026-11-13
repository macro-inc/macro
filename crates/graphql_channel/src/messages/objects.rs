//! GraphQL shapes of channel messages, timeline pages and change pages.

use activity::domain::timeline::TimelineActivity;
use async_graphql::{Enum, ID, Json, SimpleObject, Union};
use chrono::{DateTime, SecondsFormat, Utc};
use messages::domain::{
    models::{
        BotSenderProfile, CountedReaction, ImportedAuthor, Message, MessageAttachment, MessageKind,
        MessageListItem, SimpleMention, ThreadState,
    },
    ports::{CallEntryStatus, MessageCursor, MessageTimelineEntry},
    service::changes::ChannelChanges,
};
use serde_json::Value;

/// The timestamp spelling the REST message routes use, so the two reads can
/// be compared value for value.
fn timestamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

/// Whether a message is an ordinary post or stands for a call.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "GraphqlChannelMessageKind")]
pub enum GraphqlChannelMessageKind {
    /// An ordinary post or reply.
    Message,
    /// The root that stands for a channel call.
    CallRoot,
}

impl From<MessageKind> for GraphqlChannelMessageKind {
    fn from(kind: MessageKind) -> Self {
        match kind {
            MessageKind::Message => Self::Message,
            MessageKind::CallRoot => Self::CallRoot,
        }
    }
}

/// The name an imported message's original author had.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelImportedAuthor")]
pub struct GraphqlChannelImportedAuthor {
    /// Display name in the source workspace.
    pub name: String,
}

impl From<ImportedAuthor> for GraphqlChannelImportedAuthor {
    fn from(author: ImportedAuthor) -> Self {
        Self { name: author.name }
    }
}

/// The persona a bot posted under.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelBotProfile")]
pub struct GraphqlChannelBotProfile {
    /// Display name of the persona.
    pub name: String,
    /// Avatar of the persona, when it has one.
    pub avatar_url: Option<String>,
}

impl From<BotSenderProfile> for GraphqlChannelBotProfile {
    fn from(profile: BotSenderProfile) -> Self {
        Self {
            name: profile.name,
            avatar_url: profile.avatar_url,
        }
    }
}

/// An entity a message mentions.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelMessageMention")]
pub struct GraphqlChannelMessageMention {
    /// Kind of the mentioned entity.
    pub entity_type: String,
    /// Identifier of the mentioned entity.
    pub entity_id: String,
}

impl From<SimpleMention> for GraphqlChannelMessageMention {
    fn from(mention: SimpleMention) -> Self {
        Self {
            entity_type: mention.entity_type,
            entity_id: mention.entity_id,
        }
    }
}

/// An entity attached to a message. Embedded in its message: the list is
/// replaced whole when the message changes.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelMessageAttachment")]
pub struct GraphqlChannelMessageAttachment {
    /// Identifier of the attachment row.
    pub attachment_id: ID,
    /// Kind of the attached entity.
    pub entity_type: String,
    /// Identifier of the attached entity.
    pub entity_id: String,
    /// Pixel width, for media.
    pub width: Option<i32>,
    /// Pixel height, for media.
    pub height: Option<i32>,
    /// When it was attached, RFC 3339.
    pub created_at: String,
}

impl From<MessageAttachment> for GraphqlChannelMessageAttachment {
    fn from(attachment: MessageAttachment) -> Self {
        Self {
            attachment_id: ID(attachment.id.to_string()),
            entity_type: attachment.entity_type,
            entity_id: attachment.entity_id,
            width: attachment.width,
            height: attachment.height,
            created_at: timestamp(attachment.created_at),
        }
    }
}

/// One emoji and everyone who reacted with it.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelMessageReaction")]
pub struct GraphqlChannelMessageReaction {
    /// The emoji.
    pub emoji: String,
    /// Users who reacted with it, in reaction order.
    pub users: Vec<String>,
}

impl From<CountedReaction> for GraphqlChannelMessageReaction {
    fn from(reaction: CountedReaction) -> Self {
        Self {
            emoji: reaction.emoji,
            users: reaction.users,
        }
    }
}

/// Where a call root's call stands.
#[derive(Enum, Clone, Copy, Debug, PartialEq, Eq)]
#[graphql(name = "GraphqlChannelCallState")]
pub enum GraphqlChannelCallState {
    /// The call is in progress.
    Live,
    /// The call ended and its record exists.
    Ended,
    /// The call's record was deleted.
    RecordDeleted,
}

/// The call a call root stands for.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelCallStatus")]
pub struct GraphqlChannelCallStatus {
    /// Where the call stands.
    pub state: GraphqlChannelCallState,
    /// When the call ended, RFC 3339.
    pub ended_at: Option<String>,
    /// How long the call lasted, in milliseconds.
    pub duration_ms: Option<i64>,
}

impl From<CallEntryStatus> for GraphqlChannelCallStatus {
    fn from(status: CallEntryStatus) -> Self {
        match status {
            CallEntryStatus::Live => Self {
                state: GraphqlChannelCallState::Live,
                ended_at: None,
                duration_ms: None,
            },
            CallEntryStatus::Ended {
                ended_at,
                duration_ms,
            } => Self {
                state: GraphqlChannelCallState::Ended,
                ended_at: Some(timestamp(ended_at)),
                duration_ms: Some(duration_ms),
            },
            CallEntryStatus::RecordDeleted => Self {
                state: GraphqlChannelCallState::RecordDeleted,
                ended_at: None,
                duration_ms: None,
            },
        }
    }
}

/// The thread a root message starts: its state and a preview of its replies.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelThreadSummary")]
pub struct GraphqlChannelThreadSummary {
    /// Who started the thread.
    pub user_id: String,
    /// Whether the thread is resolved.
    pub resolved: bool,
    /// When the thread was created, RFC 3339.
    pub created_at: String,
    /// When the thread state last changed, RFC 3339.
    pub updated_at: String,
    /// When the thread was deleted, RFC 3339.
    pub deleted_at: Option<String>,
    /// Live replies in the thread.
    pub reply_count: i64,
    /// When the newest live reply was posted, RFC 3339.
    pub latest_reply_at: Option<String>,
    /// The oldest few live replies.
    pub preview: Vec<GraphqlChannelMessage>,
}

/// A channel message: a root or a reply. Normalized by `id`, so a page, a
/// thread and a change page all describe the same record.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelMessage")]
pub struct GraphqlChannelMessage {
    /// The message id.
    pub id: ID,
    /// The channel the message belongs to.
    pub channel_id: ID,
    /// The root this message replies to; null on a root.
    pub thread_id: Option<ID>,
    /// Ordinary message or call root.
    pub kind: GraphqlChannelMessageKind,
    /// Who sent it: a user id or a bot identity.
    pub sender_id: String,
    /// Display name of a guest sender.
    pub guest_name: Option<String>,
    /// Original author of an imported message.
    pub imported_author: Option<GraphqlChannelImportedAuthor>,
    /// Persona a bot posted under.
    pub bot_profile: Option<GraphqlChannelBotProfile>,
    /// Entities the message mentions.
    pub mentions: Vec<GraphqlChannelMessageMention>,
    /// The user a bot posted for.
    pub triggered_by: Option<String>,
    /// The client a bot post was made through.
    pub triggered_via: Option<String>,
    /// Message body; empty on a deleted message.
    pub content: String,
    /// When it was posted, RFC 3339.
    pub created_at: String,
    /// When it last changed, RFC 3339.
    pub updated_at: String,
    /// When its body was last edited, RFC 3339.
    pub edited_at: Option<String>,
    /// When it was deleted, RFC 3339.
    pub deleted_at: Option<String>,
    /// Attached entities.
    pub attachments: Vec<GraphqlChannelMessageAttachment>,
    /// Reactions grouped by emoji.
    pub reactions: Vec<GraphqlChannelMessageReaction>,
    /// The thread this root starts; null on a reply.
    pub thread: Option<GraphqlChannelThreadSummary>,
    /// The call this root stands for; null unless it is a call root.
    pub call: Option<GraphqlChannelCallStatus>,
}

impl GraphqlChannelMessage {
    /// A reply, or any message read without its thread.
    pub(crate) fn reply(message: Message) -> Self {
        Self {
            id: ID(message.id.to_string()),
            channel_id: ID(message.parent.entity_id()),
            thread_id: message.thread_id.map(|root| ID(root.to_string())),
            kind: message.kind.into(),
            sender_id: message.sender_id.as_ref().to_owned(),
            guest_name: message.guest_name,
            imported_author: message.imported_author.map(Into::into),
            bot_profile: message.bot_profile.map(Into::into),
            mentions: message.mentions.into_iter().map(Into::into).collect(),
            triggered_by: message.triggered_by,
            triggered_via: message.triggered_via,
            content: message.content,
            created_at: timestamp(message.created_at),
            updated_at: timestamp(message.updated_at),
            edited_at: message.edited_at.map(timestamp),
            deleted_at: message.deleted_at.map(timestamp),
            attachments: message.attachments.into_iter().map(Into::into).collect(),
            reactions: message.reactions.into_iter().map(Into::into).collect(),
            thread: None,
            call: None,
        }
    }

    /// A root with its thread, and its call when it stands for one.
    pub(crate) fn root(item: MessageListItem, call: Option<CallEntryStatus>) -> Self {
        let MessageListItem {
            message,
            state,
            thread,
        } = item;
        let ThreadState {
            user_id,
            resolved,
            created_at,
            updated_at,
            deleted_at,
            ..
        } = state;
        Self {
            thread: Some(GraphqlChannelThreadSummary {
                user_id,
                resolved,
                created_at: timestamp(created_at),
                updated_at: timestamp(updated_at),
                deleted_at: deleted_at.map(timestamp),
                reply_count: thread.reply_count,
                latest_reply_at: thread.latest_reply_at.map(timestamp),
                preview: thread.preview.into_iter().map(Self::reply).collect(),
            }),
            call: call.map(Into::into),
            ..Self::reply(message)
        }
    }
}

/// A fact the channel timeline shows between messages: a rename, a join.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelTimelineActivity")]
pub struct GraphqlChannelTimelineActivity {
    /// The activity id.
    pub id: ID,
    /// Who did it.
    pub actor_id: String,
    /// When it happened, RFC 3339.
    pub occurred_at: String,
    /// What happened, as the stored action tag.
    pub action: String,
    /// The action's stored payload.
    pub payload: Option<Json<Value>>,
}

impl From<TimelineActivity> for GraphqlChannelTimelineActivity {
    fn from(activity: TimelineActivity) -> Self {
        Self {
            id: ID(activity.id.to_string()),
            actor_id: activity.actor_id,
            occurred_at: timestamp(activity.occurred_at),
            action: activity.action,
            payload: activity.payload.map(Json),
        }
    }
}

/// One row of a channel timeline.
#[derive(Union, Clone, Debug)]
#[allow(clippy::large_enum_variant)] // Most rows are messages; boxing them would allocate per row.
#[graphql(name = "GraphqlChannelTimelineEntry")]
pub enum GraphqlChannelTimelineEntry {
    /// A root message, with its thread and call.
    Message(GraphqlChannelMessage),
    /// A fact shown between messages.
    Activity(GraphqlChannelTimelineActivity),
}

impl From<MessageTimelineEntry> for GraphqlChannelTimelineEntry {
    fn from(entry: MessageTimelineEntry) -> Self {
        match entry {
            MessageTimelineEntry::Message { message } => {
                Self::Message(GraphqlChannelMessage::root(*message, None))
            }
            MessageTimelineEntry::Call { message, status } => {
                Self::Message(GraphqlChannelMessage::root(*message, Some(status)))
            }
            MessageTimelineEntry::Activity { activity } => Self::Activity(activity.into()),
        }
    }
}

/// One page of a channel timeline, newest entry first.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelTimelinePage")]
pub struct GraphqlChannelTimelinePage {
    /// The channel's change sequence number, read before the page: asking
    /// for changes after it misses nothing the page lacks.
    pub seq: i64,
    /// The page's rows.
    pub entries: Vec<GraphqlChannelTimelineEntry>,
    /// Continues toward older rows; null when none remain.
    pub older_cursor: Option<GraphqlChannelTimelineCursor>,
    /// Continues toward newer rows; null when none remain.
    pub newer_cursor: Option<GraphqlChannelTimelineCursor>,
}

/// A position in a channel timeline: the row a page ends at. A client
/// passes it back to continue, and compares rows against it to tell
/// whether a row falls inside the pages it holds.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelTimelineCursor")]
pub struct GraphqlChannelTimelineCursor {
    /// When the row at this position was created or occurred, RFC 3339.
    pub created_at: String,
    /// The row's id, which orders rows of one instant. Not named `id`: a
    /// position is not an entity for a client cache to keep by id.
    pub entry_id: ID,
}

impl From<MessageCursor> for GraphqlChannelTimelineCursor {
    fn from(cursor: MessageCursor) -> Self {
        Self {
            created_at: timestamp(cursor.created_at),
            entry_id: ID(cursor.id.to_string()),
        }
    }
}

/// One page of a thread's replies, in thread order.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelThreadPage")]
pub struct GraphqlChannelThreadPage {
    /// The channel's change sequence number, read before the page.
    pub seq: i64,
    /// The thread's root.
    pub root_id: ID,
    /// The thread's root, with its thread summary and call. Present in a
    /// window read without a cursor; a continued window leaves it out.
    pub root: Option<GraphqlChannelMessage>,
    /// The page's replies.
    pub replies: Vec<GraphqlChannelMessage>,
    /// Continues toward earlier replies; null when none remain.
    pub older_cursor: Option<String>,
    /// Continues toward later replies; null when none remain.
    pub newer_cursor: Option<String>,
}

/// What changed in a channel after a sequence number.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(name = "GraphqlChannelChanges")]
pub struct GraphqlChannelChanges {
    /// The log cannot answer from that number: drop what is cached for the
    /// channel and read its latest page again.
    pub reset: bool,
    /// The number these changes bring the reader to.
    pub seq: i64,
    /// More changes follow; ask again from `seq`.
    pub has_more: bool,
    /// Roots that were posted or changed, in their current state.
    pub entries: Vec<GraphqlChannelTimelineEntry>,
    /// Replies that were posted or changed, in their current state.
    pub replies: Vec<GraphqlChannelMessage>,
    /// Timeline facts that were recorded.
    pub activities: Vec<GraphqlChannelTimelineActivity>,
    /// Messages that no longer exist for a reader.
    pub removed: Vec<ID>,
}

impl From<ChannelChanges> for GraphqlChannelChanges {
    fn from(changes: ChannelChanges) -> Self {
        Self {
            reset: changes.reset,
            seq: changes.seq,
            has_more: changes.has_more,
            entries: changes.entries.into_iter().map(Into::into).collect(),
            replies: changes
                .replies
                .into_iter()
                .map(GraphqlChannelMessage::reply)
                .collect(),
            activities: changes.activities.into_iter().map(Into::into).collect(),
            removed: changes
                .removed
                .into_iter()
                .map(|id| ID(id.to_string()))
                .collect(),
        }
    }
}
