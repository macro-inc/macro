use serde::Deserialize;
use uuid::Uuid;

use crate::client::{Acknowledged, Form, SlackClient};
use crate::error::SlackError;
use crate::ids::{ChannelId, MessageTs};
use crate::method::SlackMethod;
use crate::models::{Block, Message};

/// `chat.postMessage` parameters.
#[derive(Clone, Debug)]
pub struct PostMessage {
    /// The conversation.
    pub channel: ChannelId,
    /// mrkdwn text; the notification and fallback text when `blocks` is set.
    pub text: String,
    /// Rich layout (usually one `rich_text` block).
    pub blocks: Vec<Block>,
    /// Reply in this thread.
    pub thread_ts: Option<MessageTs>,
    /// Also show a thread reply in the channel.
    pub reply_broadcast: bool,
    /// Idempotency key the message echoes back as `client_msg_id`.
    pub client_msg_id: Uuid,
}

/// A sent message.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct PostedMessage {
    /// The conversation.
    pub channel: ChannelId,
    /// The new message's id.
    pub ts: MessageTs,
    /// The message as Slack stored it.
    pub message: Message,
}

/// `chat.update` parameters.
#[derive(Clone, Debug)]
pub struct UpdateMessage {
    /// The conversation.
    pub channel: ChannelId,
    /// The message.
    pub ts: MessageTs,
    /// New mrkdwn text.
    pub text: String,
    /// New blocks.
    pub blocks: Vec<Block>,
}

/// An edited message.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct UpdatedMessage {
    /// The conversation.
    pub channel: ChannelId,
    /// The message.
    pub ts: MessageTs,
    /// The new text.
    #[serde(default)]
    pub text: String,
}

/// A deleted message.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct DeletedMessage {
    /// The conversation.
    pub channel: ChannelId,
    /// The message.
    pub ts: MessageTs,
}

fn push_blocks(form: &mut Form, method: SlackMethod, blocks: &[Block]) -> Result<(), SlackError> {
    if blocks.is_empty() {
        return Ok(());
    }
    let blocks =
        serde_json::to_string(blocks).map_err(|source| SlackError::Decode { method, source })?;
    form.push(("blocks", blocks));
    Ok(())
}

impl SlackClient {
    /// `chat.postMessage` as the user.
    pub async fn post_message(&self, message: &PostMessage) -> Result<PostedMessage, SlackError> {
        let method = SlackMethod::ChatPostMessage;
        let mut form = vec![
            ("channel", message.channel.to_string()),
            ("text", message.text.clone()),
            ("client_msg_id", message.client_msg_id.to_string()),
            ("unfurl_links", "true".to_owned()),
            ("unfurl_media", "true".to_owned()),
        ];
        push_blocks(&mut form, method, &message.blocks)?;
        if let Some(thread_ts) = &message.thread_ts {
            form.push(("thread_ts", thread_ts.to_string()));
            form.push(("reply_broadcast", message.reply_broadcast.to_string()));
        }
        self.call(method, form).await
    }

    /// `chat.update`: edits one of the user's messages.
    pub async fn update_message(
        &self,
        update: &UpdateMessage,
    ) -> Result<UpdatedMessage, SlackError> {
        let method = SlackMethod::ChatUpdate;
        let mut form = vec![
            ("channel", update.channel.to_string()),
            ("ts", update.ts.to_string()),
            ("text", update.text.clone()),
        ];
        push_blocks(&mut form, method, &update.blocks)?;
        self.call(method, form).await
    }

    /// `chat.delete`: deletes one of the user's messages.
    pub async fn delete_message(
        &self,
        channel: &ChannelId,
        ts: &MessageTs,
    ) -> Result<DeletedMessage, SlackError> {
        let form = vec![("channel", channel.to_string()), ("ts", ts.to_string())];
        self.call(SlackMethod::ChatDelete, form).await
    }

    /// `reactions.add`; `name` is the emoji name without colons.
    pub async fn add_reaction(
        &self,
        channel: &ChannelId,
        ts: &MessageTs,
        name: &str,
    ) -> Result<(), SlackError> {
        let form = vec![
            ("channel", channel.to_string()),
            ("timestamp", ts.to_string()),
            ("name", name.to_owned()),
        ];
        self.call::<Acknowledged>(SlackMethod::ReactionsAdd, form)
            .await
            .map(|_| ())
    }

    /// `reactions.remove`.
    pub async fn remove_reaction(
        &self,
        channel: &ChannelId,
        ts: &MessageTs,
        name: &str,
    ) -> Result<(), SlackError> {
        let form = vec![
            ("channel", channel.to_string()),
            ("timestamp", ts.to_string()),
            ("name", name.to_owned()),
        ];
        self.call::<Acknowledged>(SlackMethod::ReactionsRemove, form)
            .await
            .map(|_| ())
    }
}
