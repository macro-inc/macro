use std::str::FromStr;

use serde::{Deserialize, Serialize};

use super::{Block, BotProfile, File, UserProfile};
use crate::ids::{AppId, BotId, ChannelId, MessageTs, TeamId, UserId};

/// A message, as history, replies and the `message` event carry it.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Message {
    /// The message's id within its conversation.
    pub ts: MessageTs,
    /// Absent for plain user messages.
    pub subtype: Option<MessageSubtype>,
    /// Sender; absent for some bot messages.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub user: Option<UserId>,
    /// Sending bot.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub bot_id: Option<BotId>,
    /// Sending bot's profile.
    pub bot_profile: Option<BotProfile>,
    /// Sending app.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub app_id: Option<AppId>,
    /// Display name override for bot messages.
    pub username: Option<String>,
    /// mrkdwn text, also the fallback when `blocks` are present.
    #[serde(default)]
    pub text: String,
    /// Rich layout; `rich_text` for messages composed in a client.
    #[serde(default)]
    pub blocks: Vec<Block>,
    /// Legacy attachments and link unfurls.
    #[serde(default)]
    pub attachments: Vec<LegacyAttachment>,
    /// Attached files.
    #[serde(default)]
    pub files: Vec<File>,
    /// Set on a reply: the thread's root `ts`. Equal to `ts` on the root.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub thread_ts: Option<MessageTs>,
    /// The thread root's author, on replies.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub parent_user_id: Option<UserId>,
    /// Replies in the thread (on the root).
    pub reply_count: Option<u32>,
    /// Distinct repliers (on the root).
    #[serde(default)]
    pub reply_users: Vec<UserId>,
    /// The latest reply's `ts` (on the root).
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub latest_reply: Option<MessageTs>,
    /// The caller's read cursor in the thread (on the root).
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub last_read: Option<MessageTs>,
    /// The caller follows the thread.
    pub subscribed: Option<bool>,
    /// Set when the message was edited.
    pub edited: Option<Edited>,
    /// Reactions.
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    /// The sender's workspace; differs from yours for Slack Connect senders.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub user_team: Option<TeamId>,
    /// The workspace the message was sent from.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub source_team: Option<TeamId>,
    /// The workspace that stores the message.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub team: Option<TeamId>,
    /// An inline profile, sent for senders the client may not know (external).
    pub user_profile: Option<UserProfile>,
    /// Client-chosen id; echoes back on your own sends.
    pub client_msg_id: Option<String>,
    /// The new topic, on `channel_topic` and `group_topic`.
    pub topic: Option<String>,
    /// The new purpose, on `channel_purpose` and `group_purpose`.
    pub purpose: Option<String>,
    /// The new name, on `channel_name` and `group_name`.
    pub name: Option<String>,
    /// Hidden from the conversation view (e.g. some edits and deletes).
    #[serde(default)]
    pub hidden: bool,
    /// A locked thread.
    #[serde(default)]
    pub is_locked: bool,
    /// The conversation, on `message_replied`'s embedded root.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub channel: Option<ChannelId>,
}

impl Message {
    /// A reply in a thread (not the root and not a top-level message).
    pub fn is_thread_reply(&self) -> bool {
        self.thread_ts
            .as_ref()
            .is_some_and(|thread_ts| *thread_ts != self.ts)
    }
}

/// Edit marker.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Edited {
    /// The editor.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub user: Option<UserId>,
    /// When.
    pub ts: MessageTs,
}

/// One emoji's reactions on a message.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Reaction {
    /// Emoji name without colons, with a `::skin-tone-N` suffix when set.
    pub name: String,
    /// Reactors (may be truncated; see `count`).
    #[serde(default)]
    pub users: Vec<UserId>,
    /// Total reactors.
    #[serde(default)]
    pub count: u32,
}

/// A legacy attachment or unfurl.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
pub struct LegacyAttachment {
    /// Plain-text summary.
    pub fallback: Option<String>,
    /// Text.
    pub text: Option<String>,
    /// Text above the attachment.
    pub pretext: Option<String>,
    /// Title.
    pub title: Option<String>,
    /// Title link.
    pub title_link: Option<String>,
    /// Author.
    pub author_name: Option<String>,
    /// The unfurled URL.
    pub from_url: Option<String>,
    /// Image.
    pub image_url: Option<String>,
    /// Thumbnail.
    pub thumb_url: Option<String>,
    /// The site's name.
    pub service_name: Option<String>,
    /// Footer.
    pub footer: Option<String>,
    /// A shared message.
    #[serde(default)]
    pub is_share: bool,
    /// An unfurled Slack message link.
    #[serde(default)]
    pub is_msg_unfurl: bool,
    /// The shared message's channel.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub channel_id: Option<ChannelId>,
    /// The shared message's ts.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub ts: Option<MessageTs>,
}

/// A message's subtype. Plain messages have none.
#[derive(
    Clone, Debug, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr, Serialize, Deserialize,
)]
#[strum(serialize_all = "snake_case")]
#[serde(from = "String", into = "String")]
pub enum MessageSubtype {
    /// Sent by a bot or integration.
    BotMessage,
    /// `/me` message.
    MeMessage,
    /// An edit: the event carries `message` and `previous_message`.
    MessageChanged,
    /// A delete: the event carries `deleted_ts` and `previous_message`.
    MessageDeleted,
    /// A thread root's reply metadata changed; carries the root in `message`.
    MessageReplied,
    /// A thread reply also sent to the channel.
    ThreadBroadcast,
    /// Someone joined the channel.
    ChannelJoin,
    /// Someone left the channel.
    ChannelLeave,
    /// Topic changed.
    ChannelTopic,
    /// Purpose changed.
    ChannelPurpose,
    /// Renamed.
    ChannelName,
    /// Archived.
    ChannelArchive,
    /// Unarchived.
    ChannelUnarchive,
    /// Converted to private.
    ChannelConvertToPrivate,
    /// Someone joined a private channel.
    GroupJoin,
    /// Someone left a private channel.
    GroupLeave,
    /// Private channel topic changed.
    GroupTopic,
    /// Private channel purpose changed.
    GroupPurpose,
    /// Private channel renamed.
    GroupName,
    /// A file shared with text.
    FileShare,
    /// Pinned.
    PinnedItem,
    /// Unpinned.
    UnpinnedItem,
    /// A huddle's thread root.
    HuddleThread,
    /// A deleted thread root kept for its replies.
    Tombstone,
    /// Enterprise key management revoked access.
    EkmAccessDenied,
    /// Reminder added.
    ReminderAdd,
    /// Slackbot's automatic reply.
    SlackbotResponse,
    /// Any other subtype, verbatim.
    #[strum(default)]
    Other(String),
}

impl From<String> for MessageSubtype {
    fn from(value: String) -> Self {
        Self::from_str(&value).unwrap_or(Self::Other(value))
    }
}

impl From<MessageSubtype> for String {
    fn from(value: MessageSubtype) -> String {
        match value {
            MessageSubtype::Other(subtype) => subtype,
            known => <&'static str>::from(known).to_owned(),
        }
    }
}
