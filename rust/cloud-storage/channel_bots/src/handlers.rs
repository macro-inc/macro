//! Bot trigger events and the built-in handlers.

use std::sync::Arc;

use async_trait::async_trait;
use bots::domain::models::Bot;
use channels::domain::models::{
    MutatedMessage, ParticipantRole, PatchMessageRequest, PostMessageRequest, Sender,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::poster::ChannelBotPoster;
use crate::responder::AgentResponder;

/// The kind of event that triggered a bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BotTrigger {
    /// The bot was `@`-mentioned in a channel message.
    Mention,
}

/// A normalized trigger delivered to a [`BotHandler`].
#[derive(Debug, Clone)]
pub struct BotEvent {
    /// What triggered the bot.
    pub trigger: BotTrigger,
    /// Channel the trigger occurred in.
    pub channel_id: Uuid,
    /// The user-authored message that triggered the bot.
    pub message: MutatedMessage,
    /// Thread the bot should reply in. For a top-level message this is the
    /// message id; for a reply it is the existing thread id.
    pub reply_thread_id: Uuid,
    /// The user who triggered the bot.
    pub requesting_user: MacroUserIdStr<'static>,
}

/// Handles a bot trigger. New bot behaviors implement this trait.
#[async_trait]
pub trait BotHandler: Send + Sync {
    /// React to a trigger for `bot`.
    async fn handle(&self, bot: &Bot, event: &BotEvent) -> anyhow::Result<()>;
}

/// Message Macro AI posts immediately, then replaces with its answer.
const THINKING_MESSAGE: &str = "_Macro AI is thinking…_";
const EMPTY_RESPONSE_FALLBACK: &str = "I wasn't able to come up with a response.";
const ERROR_FALLBACK: &str = "Sorry — I ran into an error while responding.";

/// In-process handler for the Macro AI system bot.
///
/// Posts an immediate "thinking" reply in a thread, runs the agent loop, then
/// edits that same message with the final answer.
pub struct MacroAiHandler {
    poster: Arc<dyn ChannelBotPoster>,
    responder: Arc<dyn AgentResponder>,
}

impl MacroAiHandler {
    /// Create a Macro AI handler.
    pub fn new(poster: Arc<dyn ChannelBotPoster>, responder: Arc<dyn AgentResponder>) -> Self {
        Self { poster, responder }
    }
}

#[async_trait]
impl BotHandler for MacroAiHandler {
    #[tracing::instrument(skip(self, _bot, event), fields(channel_id = %event.channel_id), err)]
    async fn handle(&self, _bot: &Bot, event: &BotEvent) -> anyhow::Result<()> {
        let actor = Sender::Bot(bot_id::MACRO_AI_BOT_ID);

        // 1. Post the immediate "thinking" message in the thread.
        let thinking = self
            .poster
            .post_message(
                actor.clone(),
                event.channel_id,
                PostMessageRequest {
                    content: THINKING_MESSAGE.to_string(),
                    mentions: Vec::new(),
                    thread_id: Some(event.reply_thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await?;
        let message_id = Uuid::parse_str(&thinking.id)?;

        // 2. Run the agent loop to produce the reply.
        let reply = match self
            .responder
            .respond(
                event.requesting_user.as_ref(),
                event.message.content.clone(),
            )
            .await
        {
            Ok(text) if !text.trim().is_empty() => text,
            Ok(_) => EMPTY_RESPONSE_FALLBACK.to_string(),
            Err(err) => {
                tracing::error!(error=?err, "macro ai responder failed");
                format!("{ERROR_FALLBACK}\n\n```\n{err:#}\n```")
            }
        };

        // 3. Replace the "thinking" message with the answer.
        self.poster
            .patch_message(
                actor,
                ParticipantRole::Member,
                event.channel_id,
                message_id,
                PatchMessageRequest {
                    content: Some(reply),
                    mentions: None,
                    attachment_ids_to_delete: None,
                    attachments_to_add: None,
                    nonce: None,
                },
            )
            .await?;

        Ok(())
    }
}

/// Delivers triggers to an external bot's webhook.
pub struct WebhookBotHandler {
    client: reqwest::Client,
}

impl WebhookBotHandler {
    /// Create a webhook handler.
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait]
impl BotHandler for WebhookBotHandler {
    #[tracing::instrument(skip(self, bot, event), fields(bot_id = %bot.id, channel_id = %event.channel_id), err)]
    async fn handle(&self, bot: &Bot, event: &BotEvent) -> anyhow::Result<()> {
        let Some(webhook_url) = bot.webhook_url.as_deref() else {
            return Ok(());
        };

        let payload = serde_json::json!({
            "trigger": match event.trigger {
                BotTrigger::Mention => "mention",
            },
            "bot_id": bot.id.to_string(),
            "channel_id": event.channel_id,
            "message_id": event.message.id,
            "thread_id": event.reply_thread_id,
            "content": event.message.content,
            "sender_id": event.message.sender_id.to_storage_string(),
        });

        let response = self.client.post(webhook_url).json(&payload).send().await?;
        if !response.status().is_success() {
            anyhow::bail!("bot webhook returned {}", response.status());
        }
        Ok(())
    }
}
