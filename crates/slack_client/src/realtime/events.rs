//! Typed events from the web client's websocket.

use serde::Deserialize;
use strum::VariantNames;

use crate::ids::{ChannelId, FileId, MessageTs, TeamId, UserId};
use crate::models::{Conversation, Message, User};

/// One frame from the websocket, after the connection handled `hello`,
/// `pong`, `reconnect_url` and `goodbye` itself.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// An event this client models.
    Known(Box<SlackEvent>),
    /// An event type this client doesn't model, kept verbatim.
    Unknown {
        /// The frame's `type`, if it had one.
        event_type: Option<String>,
        /// The whole frame.
        raw: serde_json::Value,
    },
    /// A modeled event type whose frame didn't decode, kept verbatim.
    Malformed {
        /// The frame's `type`.
        event_type: String,
        /// Why it didn't decode.
        error: String,
        /// The whole frame.
        raw: serde_json::Value,
    },
}

#[derive(Deserialize)]
struct FrameType {
    #[serde(rename = "type")]
    event_type: Option<String>,
}

impl Event {
    /// Classifies a frame. Never fails: unknown and undecodable frames are
    /// preserved as raw JSON.
    pub fn parse(raw: serde_json::Value) -> Self {
        let event_type = serde_json::from_value::<FrameType>(raw.clone())
            .ok()
            .and_then(|frame| frame.event_type);
        let Some(known_type) = event_type
            .as_deref()
            .filter(|event_type| SlackEvent::VARIANTS.contains(event_type))
        else {
            return Self::Unknown { event_type, raw };
        };
        match serde_json::from_value::<SlackEvent>(raw.clone()) {
            Ok(event) => Self::Known(Box::new(event)),
            Err(error) => Self::Malformed {
                event_type: known_type.to_owned(),
                error: error.to_string(),
                raw,
            },
        }
    }
}

/// The events a chat client acts on.
#[derive(Clone, Debug, PartialEq, Deserialize, strum::VariantNames)]
#[serde(tag = "type", rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SlackEvent {
    /// A message, an edit (`message_changed`), a delete (`message_deleted`),
    /// a thread root update (`message_replied`) or another subtype.
    Message(MessageEvent),
    /// A reaction was added.
    ReactionAdded(ReactionEvent),
    /// A reaction was removed.
    ReactionRemoved(ReactionEvent),
    /// The user read a channel elsewhere.
    ChannelMarked(MarkedEvent),
    /// The user read a DM elsewhere.
    ImMarked(MarkedEvent),
    /// The user read a private channel elsewhere.
    GroupMarked(MarkedEvent),
    /// The user read a group DM elsewhere.
    MpimMarked(MarkedEvent),
    /// The user read a thread elsewhere.
    ThreadMarked(ThreadMarkedEvent),
    /// The user joined a channel.
    ChannelJoined(JoinedEvent),
    /// The user joined a private channel.
    GroupJoined(JoinedEvent),
    /// The user left a channel.
    ChannelLeft(ChannelEvent),
    /// The user left a private channel.
    GroupLeft(ChannelEvent),
    /// A channel was renamed.
    ChannelRename(RenameEvent),
    /// A private channel was renamed.
    GroupRename(RenameEvent),
    /// A private channel's id changed when it became shared (`G…` → `C…`).
    ChannelIdChanged(ChannelIdChangedEvent),
    /// A channel was archived.
    ChannelArchive(ChannelEvent),
    /// A channel was unarchived.
    ChannelUnarchive(ChannelEvent),
    /// A channel was deleted.
    ChannelDeleted(ChannelEvent),
    /// A private channel was archived.
    GroupArchive(ChannelEvent),
    /// A channel was shared with another organization.
    ChannelShared(ChannelSharedEvent),
    /// A channel stopped being shared with an organization.
    ChannelUnshared(ChannelUnsharedEvent),
    /// A Slack Connect invitation was accepted.
    SharedChannelInviteAccepted(SharedChannelInviteEvent),
    /// A Slack Connect invitation was approved by an admin.
    SharedChannelInviteApproved(SharedChannelInviteEvent),
    /// A Slack Connect invitation was declined.
    SharedChannelInviteDeclined(SharedChannelInviteEvent),
    /// The user received a Slack Connect invitation.
    SharedChannelInviteReceived(SharedChannelInviteEvent),
    /// Someone joined a conversation.
    MemberJoinedChannel(MemberChannelEvent),
    /// Someone left a conversation.
    MemberLeftChannel(MemberChannelEvent),
    /// A DM was opened for the first time.
    ImCreated(ImEvent),
    /// A DM was opened in the sidebar.
    ImOpen(ImEvent),
    /// A DM was closed in the sidebar.
    ImClose(ImEvent),
    /// A user's profile changed.
    UserChange(UserEvent),
    /// A user joined the workspace.
    TeamJoin(UserEvent),
    /// Someone is typing.
    UserTyping(TypingEvent),
    /// A file was created.
    FileCreated(FileEvent),
    /// A file was shared into a conversation.
    FileShared(FileEvent),
    /// A file changed.
    FileChange(FileEvent),
    /// A file was deleted.
    FileDeleted(FileEvent),
    /// A file was unshared.
    FileUnshared(FileEvent),
    /// Custom emoji changed.
    EmojiChanged(EmojiChangedEvent),
}

/// A `message` event.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct MessageEvent {
    /// The conversation.
    pub channel: ChannelId,
    /// The message (for `message_changed`, the edit's own envelope ts).
    #[serde(flatten)]
    pub message: Message,
    /// The edited message after the change (`message_changed`), or the
    /// thread root (`message_replied`).
    #[serde(rename = "message")]
    pub changed_message: Option<Box<Message>>,
    /// The message before the change or delete.
    pub previous_message: Option<Box<Message>>,
    /// The deleted message (`message_deleted`).
    pub deleted_ts: Option<MessageTs>,
    /// When the event happened.
    pub event_ts: Option<MessageTs>,
}

/// `reaction_added` / `reaction_removed`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ReactionEvent {
    /// Who reacted.
    pub user: UserId,
    /// Emoji name without colons.
    pub reaction: String,
    /// The author of the reacted item.
    pub item_user: Option<UserId>,
    /// The reacted item.
    pub item: ReactionItem,
    /// When.
    pub event_ts: Option<MessageTs>,
}

/// What a reaction is on.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReactionItem {
    /// A message.
    Message {
        /// The conversation.
        channel: ChannelId,
        /// The message.
        ts: MessageTs,
    },
    /// A file.
    File {
        /// The file.
        file: FileId,
    },
}

/// `*_marked`: the user's read cursor moved in another client.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct MarkedEvent {
    /// The conversation.
    pub channel: ChannelId,
    /// The new read cursor.
    pub ts: MessageTs,
    /// Unread messages left.
    pub unread_count_display: Option<u32>,
    /// Unread mentions left.
    pub mention_count: Option<u32>,
}

/// `thread_marked`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ThreadMarkedEvent {
    /// The thread subscription that moved.
    pub subscription: ThreadSubscription,
}

/// A followed thread's read state.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ThreadSubscription {
    /// The conversation.
    pub channel: ChannelId,
    /// The thread root.
    pub thread_ts: MessageTs,
    /// The new read cursor.
    pub last_read: MessageTs,
    /// Still followed.
    #[serde(default)]
    pub active: bool,
}

/// `channel_joined` / `group_joined`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct JoinedEvent {
    /// The conversation.
    pub channel: Conversation,
}

/// An event naming one conversation.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ChannelEvent {
    /// The conversation.
    pub channel: ChannelId,
    /// Who did it, when Slack says.
    pub user: Option<UserId>,
}

/// `channel_rename` / `group_rename`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct RenameEvent {
    /// The conversation with its new name.
    pub channel: RenamedChannel,
}

/// A renamed conversation.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct RenamedChannel {
    /// The conversation.
    pub id: ChannelId,
    /// The new name.
    pub name: String,
}

/// `channel_id_changed`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ChannelIdChangedEvent {
    /// The old id.
    pub old_channel_id: ChannelId,
    /// The new id.
    pub new_channel_id: ChannelId,
}

/// `channel_shared`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ChannelSharedEvent {
    /// The conversation.
    pub channel: ChannelId,
    /// The newly connected organization.
    pub connected_team_id: TeamId,
}

/// `channel_unshared`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ChannelUnsharedEvent {
    /// The conversation.
    pub channel: ChannelId,
    /// The organization that left.
    pub previously_connected_team_id: TeamId,
    /// Still shared with someone else.
    #[serde(default)]
    pub is_ext_shared: bool,
}

/// `shared_channel_invite_*`. The invitation's shape varies; it is kept raw.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SharedChannelInviteEvent {
    /// The invitation.
    pub invite: Option<serde_json::Value>,
    /// The conversation.
    pub channel: Option<serde_json::Value>,
}

/// `member_joined_channel` / `member_left_channel`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct MemberChannelEvent {
    /// The member.
    pub user: UserId,
    /// The conversation.
    pub channel: ChannelId,
    /// The member's workspace.
    pub team: Option<TeamId>,
    /// Who added them.
    pub inviter: Option<UserId>,
}

/// `im_created` / `im_open` / `im_close`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ImEvent {
    /// The DM: an id, or the full conversation on `im_created`.
    pub channel: ImChannel,
    /// The other person.
    pub user: Option<UserId>,
}

/// A DM reference.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum ImChannel {
    /// Just the id.
    Id(ChannelId),
    /// The whole conversation.
    Conversation(Box<Conversation>),
}

/// `user_change` / `team_join`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct UserEvent {
    /// The user.
    pub user: User,
}

/// `user_typing`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct TypingEvent {
    /// The conversation.
    pub channel: ChannelId,
    /// Who is typing.
    pub user: UserId,
    /// The thread, when typing a reply.
    pub thread_ts: Option<MessageTs>,
}

/// `file_*`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct FileEvent {
    /// The file.
    pub file_id: FileId,
    /// The conversation, on shares.
    pub channel_id: Option<ChannelId>,
    /// Who did it.
    pub user_id: Option<UserId>,
}

/// `emoji_changed`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct EmojiChangedEvent {
    /// `add`, `remove` or `rename`.
    pub subtype: Option<String>,
    /// The added emoji.
    pub name: Option<String>,
    /// The removed emoji.
    #[serde(default)]
    pub names: Vec<String>,
    /// The added emoji's image URL or `alias:` target.
    pub value: Option<String>,
}
