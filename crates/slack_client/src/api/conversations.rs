use serde::Deserialize;

use crate::client::{Acknowledged, Form, SlackClient};
use crate::error::SlackError;
use crate::ids::{ChannelId, MessageTs, UserId};
use crate::method::SlackMethod;
use crate::models::{Conversation, Message, ResponseMetadata, User};

/// Slack's page size ceiling for list methods.
const MAX_PAGE_SIZE: u16 = 1000;

/// A conversation type for `users.conversations`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ConversationType {
    /// Public channels.
    PublicChannel,
    /// Private channels.
    PrivateChannel,
    /// Group DMs.
    Mpim,
    /// DMs.
    Im,
}

/// `users.conversations` parameters.
#[derive(Clone, Debug)]
pub struct UsersConversationsRequest {
    /// Types to list.
    pub types: Vec<ConversationType>,
    /// Skip archived channels.
    pub exclude_archived: bool,
    /// Page size, up to 1000.
    pub limit: u16,
    /// The previous page's cursor.
    pub cursor: Option<String>,
}

/// One page of conversations.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ConversationsPage {
    /// The conversations.
    #[serde(default)]
    pub channels: Vec<Conversation>,
    /// Pagination.
    #[serde(default)]
    pub response_metadata: ResponseMetadata,
}

/// `conversations.history` parameters.
#[derive(Clone, Debug)]
pub struct HistoryRequest {
    /// The conversation.
    pub channel: ChannelId,
    /// Only messages before this (newest first).
    pub latest: Option<MessageTs>,
    /// Only messages after this.
    pub oldest: Option<MessageTs>,
    /// Include `latest`/`oldest` themselves.
    pub inclusive: bool,
    /// Page size, up to 1000.
    pub limit: u16,
    /// The previous page's cursor.
    pub cursor: Option<String>,
}

/// `conversations.replies` parameters.
#[derive(Clone, Debug)]
pub struct RepliesRequest {
    /// The conversation.
    pub channel: ChannelId,
    /// The thread root.
    pub thread_ts: MessageTs,
    /// Only replies after this.
    pub oldest: Option<MessageTs>,
    /// Only replies before this.
    pub latest: Option<MessageTs>,
    /// Include `latest`/`oldest` themselves.
    pub inclusive: bool,
    /// Page size, up to 1000.
    pub limit: u16,
    /// The previous page's cursor.
    pub cursor: Option<String>,
}

/// One page of messages. History pages are newest first; replies pages are
/// oldest first and start with the root.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct HistoryPage {
    /// The messages.
    #[serde(default)]
    pub messages: Vec<Message>,
    /// More messages exist past this page.
    #[serde(default)]
    pub has_more: bool,
    /// Pagination.
    #[serde(default)]
    pub response_metadata: ResponseMetadata,
}

/// One page of member ids.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct MembersPage {
    /// Members.
    #[serde(default)]
    pub members: Vec<UserId>,
    /// Pagination.
    #[serde(default)]
    pub response_metadata: ResponseMetadata,
}

/// `conversations.view`: what the web client loads when opening a
/// conversation.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ConversationView {
    /// The conversation.
    pub channel: Conversation,
    /// Profiles of the people in view, external users included.
    #[serde(default)]
    pub users: Vec<User>,
}

#[derive(Deserialize)]
struct ConversationEnvelope {
    channel: Conversation,
}

fn push_optional(form: &mut Form, name: &'static str, value: Option<impl ToString>) {
    if let Some(value) = value {
        form.push((name, value.to_string()));
    }
}

impl SlackClient {
    /// `users.conversations`: one page of the user's conversations.
    pub async fn users_conversations(
        &self,
        request: &UsersConversationsRequest,
    ) -> Result<ConversationsPage, SlackError> {
        let types: Vec<&'static str> = request.types.iter().map(|kind| (*kind).into()).collect();
        let mut form = vec![
            ("types", types.join(",")),
            ("exclude_archived", request.exclude_archived.to_string()),
            ("limit", request.limit.min(MAX_PAGE_SIZE).to_string()),
        ];
        push_optional(&mut form, "cursor", request.cursor.as_ref());
        self.call(SlackMethod::UsersConversations, form).await
    }

    /// `conversations.info`.
    pub async fn conversation_info(&self, channel: &ChannelId) -> Result<Conversation, SlackError> {
        let form = vec![
            ("channel", channel.to_string()),
            ("include_num_members", "true".to_owned()),
        ];
        self.call::<ConversationEnvelope>(SlackMethod::ConversationsInfo, form)
            .await
            .map(|envelope| envelope.channel)
    }

    /// `conversations.history`: one page, newest first.
    pub async fn history(&self, request: &HistoryRequest) -> Result<HistoryPage, SlackError> {
        let mut form = vec![
            ("channel", request.channel.to_string()),
            ("inclusive", request.inclusive.to_string()),
            ("limit", request.limit.min(MAX_PAGE_SIZE).to_string()),
        ];
        push_optional(&mut form, "latest", request.latest.as_ref());
        push_optional(&mut form, "oldest", request.oldest.as_ref());
        push_optional(&mut form, "cursor", request.cursor.as_ref());
        self.call(SlackMethod::ConversationsHistory, form).await
    }

    /// `conversations.replies`: one page of a thread, root first.
    pub async fn replies(&self, request: &RepliesRequest) -> Result<HistoryPage, SlackError> {
        let mut form = vec![
            ("channel", request.channel.to_string()),
            ("ts", request.thread_ts.to_string()),
            ("inclusive", request.inclusive.to_string()),
            ("limit", request.limit.min(MAX_PAGE_SIZE).to_string()),
        ];
        push_optional(&mut form, "latest", request.latest.as_ref());
        push_optional(&mut form, "oldest", request.oldest.as_ref());
        push_optional(&mut form, "cursor", request.cursor.as_ref());
        self.call(SlackMethod::ConversationsReplies, form).await
    }

    /// `conversations.view`.
    pub async fn conversation_view(&self, channel: &ChannelId) -> Result<ConversationView, SlackError> {
        let form = vec![
            ("channel", channel.to_string()),
            ("canonical_avatars", "true".to_owned()),
            ("no_user_profile", "false".to_owned()),
            ("ignore_replies", "true".to_owned()),
            ("no_self", "true".to_owned()),
            ("include_full_users", "true".to_owned()),
        ];
        self.call(SlackMethod::ConversationsView, form).await
    }

    /// `conversations.members`: one page of member ids.
    pub async fn members(
        &self,
        channel: &ChannelId,
        cursor: Option<&str>,
        limit: u16,
    ) -> Result<MembersPage, SlackError> {
        let mut form = vec![
            ("channel", channel.to_string()),
            ("limit", limit.min(MAX_PAGE_SIZE).to_string()),
        ];
        push_optional(&mut form, "cursor", cursor);
        self.call(SlackMethod::ConversationsMembers, form).await
    }

    /// `conversations.mark`: moves the user's read cursor to `ts`.
    pub async fn mark_read(&self, channel: &ChannelId, ts: &MessageTs) -> Result<(), SlackError> {
        let form = vec![("channel", channel.to_string()), ("ts", ts.to_string())];
        self.call::<Acknowledged>(SlackMethod::ConversationsMark, form)
            .await
            .map(|_| ())
    }

    /// `subscriptions.thread.mark`: marks a thread read up to `ts`.
    pub async fn mark_thread_read(
        &self,
        channel: &ChannelId,
        thread_ts: &MessageTs,
        ts: &MessageTs,
    ) -> Result<(), SlackError> {
        let form = vec![
            ("channel", channel.to_string()),
            ("thread_ts", thread_ts.to_string()),
            ("ts", ts.to_string()),
            ("read", "1".to_owned()),
        ];
        self.call::<Acknowledged>(SlackMethod::SubscriptionsThreadMark, form)
            .await
            .map(|_| ())
    }
}
