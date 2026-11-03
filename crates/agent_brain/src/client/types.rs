//! Request and response bodies for the Macro HTTP API.
//!
//! Responses ignore fields this crate does not model, so new backend fields
//! never break an agent's daemon.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The caller, from `GET {auth}/user/me`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Me {
    /// The user id, e.g. `macro|agent@example.com`. Mentions and message
    /// senders use this same form.
    pub user_id: String,
    /// The caller's permissions.
    #[serde(default)]
    pub permissions: Vec<String>,
    /// The caller's organization, if any.
    #[serde(default)]
    pub organization_id: Option<i64>,
}

/// A mention of an entity (usually a user) inside a message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mention {
    /// The mentioned entity's id; for a user, `macro|email`.
    pub entity_id: String,
    /// The mentioned entity's type, e.g. `user`.
    pub entity_type: String,
}

/// A message to post with [`MacroClient::post_message`](crate::MacroClient::post_message).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewMessage {
    /// Macro Markdown body.
    pub content: String,
    /// Mentions to track.
    #[serde(default)]
    pub mentions: Vec<Mention>,
    /// Attachments, as raw JSON in the backend's `NewAttachment` shape.
    #[serde(default)]
    pub attachments: Vec<Value>,
    /// The thread root to reply to; `None` posts at the channel root.
    pub thread_id: Option<String>,
    /// Client nonce; filled with a fresh UUID when empty.
    pub nonce: Option<String>,
}

impl NewMessage {
    /// A top-level message with this Markdown body.
    pub fn text(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            mentions: Vec::new(),
            attachments: Vec::new(),
            thread_id: None,
            nonce: None,
        }
    }

    /// Post it as a reply in the thread rooted at `root_id`.
    pub fn in_thread(mut self, root_id: impl Into<String>) -> Self {
        self.thread_id = Some(root_id.into());
        self
    }

    /// Track a mention of a user (`macro|email`).
    pub fn mention_user(mut self, user_id: impl Into<String>) -> Self {
        self.mentions.push(Mention {
            entity_id: user_id.into(),
            entity_type: "user".to_owned(),
        });
        self
    }
}

/// A message as Macro returns it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    /// Message id.
    pub id: String,
    /// Macro Markdown body.
    pub content: String,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// The author, e.g. `macro|someone@example.com` or `bot|<uuid>`.
    #[serde(default)]
    pub sender_id: String,
    /// The thread root for replies; `None` for roots.
    #[serde(default)]
    pub thread_id: Option<String>,
    /// Tracked mentions.
    #[serde(default)]
    pub mentions: Vec<Mention>,
    /// Attached entities, as raw JSON.
    #[serde(default)]
    pub attachments: Vec<Value>,
}

/// A root message in a channel timeline, with a preview of its thread.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ListedMessage {
    /// The root message.
    #[serde(flatten)]
    pub message: Message,
    /// Its thread, if it has replies.
    #[serde(default)]
    pub thread: Option<ThreadPreview>,
}

/// A bounded preview of a thread.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadPreview {
    /// Total replies.
    #[serde(default)]
    pub reply_count: u64,
    /// The latest reply time.
    #[serde(default)]
    pub latest_reply_at: Option<DateTime<Utc>>,
    /// The most recent replies.
    #[serde(default)]
    pub preview: Vec<Message>,
}

/// A position in a timeline, for paging.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageCursor {
    /// Last message time.
    pub created_at: String,
    /// Last message id.
    pub id: String,
}

/// Which root messages to read with [`MacroClient::channel_messages`](crate::MacroClient::channel_messages).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimelineQuery {
    /// Only roots created, or replied to, at or after this time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_after: Option<DateTime<Utc>>,
    /// Only these roots (e.g. one thread).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub ids: Vec<String>,
    /// Page size, 1..=100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u8>,
    /// Continue after this cursor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<MessageCursor>,
}

/// One page of root messages, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessagePage {
    /// Root messages with thread previews.
    pub items: Vec<ListedMessage>,
    /// Cursor for the next (older) page.
    #[serde(default)]
    pub next_cursor: Option<MessageCursor>,
}

/// A channel's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    /// Open to the team or organization.
    Public,
    /// Invite only.
    Private,
    /// A one-to-one or group direct message.
    DirectMessage,
    /// A team channel.
    Team,
    /// A kind this crate does not know yet.
    #[serde(other)]
    Unknown,
}

/// A channel, from `GET {storage}/channels/{id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelDetail {
    /// Channel id.
    pub channel_id: String,
    /// Display name from the caller's perspective.
    #[serde(default)]
    pub channel_name: String,
    /// The channel's kind.
    pub channel_type: ChannelType,
    /// Members, as raw JSON.
    #[serde(default)]
    pub participants: Vec<Value>,
}

impl ChannelDetail {
    /// Whether this is a direct message, where everything is addressed to
    /// the agent.
    pub fn is_direct_message(&self) -> bool {
        self.channel_type == ChannelType::DirectMessage
    }
}

/// The body of `POST {cognition}/decisions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecideRequest {
    /// Anything the questions should be judged against.
    pub input: Value,
    /// Question key to yes/no question.
    pub questions: BTreeMap<String, String>,
}

/// The answer to a [`DecideRequest`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecideResponse {
    /// Question key to probability of "yes", 0.0..=1.0.
    pub probabilities: BTreeMap<String, f64>,
}

/// This team agent's profile, from `GET {auth}/team_agents/me`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamAgentProfile {
    /// The agent's user id.
    pub user_id: String,
    /// The team it belongs to.
    pub team_id: String,
    /// Display name.
    pub name: String,
    /// What the team hired it to do.
    #[serde(default)]
    pub job_description: Option<String>,
    /// How it should come across.
    #[serde(default)]
    pub personality: Option<String>,
    /// Its email address.
    #[serde(default)]
    pub email: Option<String>,
    /// Who created it.
    #[serde(default)]
    pub created_by: Option<String>,
}

/// One received email.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    /// Message id.
    pub message_id: String,
    /// Thread id.
    #[serde(default)]
    pub thread_id: Option<String>,
    /// Sender.
    #[serde(default)]
    pub from: String,
    /// Recipients.
    #[serde(default)]
    pub to: Vec<String>,
    /// Subject line.
    #[serde(default)]
    pub subject: Option<String>,
    /// A short preview.
    #[serde(default)]
    pub preview: Option<String>,
    /// Plain-text body.
    #[serde(default)]
    pub text: Option<String>,
    /// When it arrived.
    #[serde(default)]
    pub received_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EmailList {
    pub(crate) messages: Vec<EmailMessage>,
}

/// An email to send from the agent's own address.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingEmail {
    /// Recipients.
    pub to: Vec<String>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text: String,
    /// Optional HTML body.
    pub html: Option<String>,
}

/// The result of sending an email.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentEmail {
    /// The sent message's id.
    pub message_id: String,
}

/// An agent session, from `POST {agent-harness}/agent-sessions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentSession {
    /// Session id.
    pub id: uuid::Uuid,
    /// Everything else the backend returned.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AgentSessionCreated {
    pub(crate) session: AgentSession,
}

/// Whether a prompt reached the agent immediately or waits behind a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptStatus {
    /// Delivered to the running agent.
    Sent,
    /// Queued behind the current turn.
    Queued,
    /// A status this crate does not know yet.
    #[serde(other)]
    Unknown,
}

/// The answer to a session prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAck {
    /// The action id sent with the prompt.
    pub action_id: uuid::Uuid,
    /// Delivery status.
    pub status: PromptStatus,
}
