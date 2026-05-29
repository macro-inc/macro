//! Bot trigger events and the built-in handlers.

use std::fmt::Write as _;
use std::sync::Arc;

use async_trait::async_trait;
use bots::domain::models::Bot;
use channels::domain::models::{
    MutatedMessage, ParticipantRole, PatchMessageRequest, PostMessageRequest, Sender,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::poster::{ChannelBotPoster, ContextMessage};
use crate::responder::AgentResponder;

/// How many recent channel messages to include as context.
const RECENT_CONTEXT_LIMIT: u16 = 10;

/// Human-readable label for a message sender storage id.
fn sender_label(sender_id: &str) -> String {
    if let Ok(bot) = bot_id::BotId::parse_storage_str(sender_id) {
        return if bot == bot_id::MACRO_AI_BOT_ID {
            bot_id::MACRO_AI_NAME.to_string()
        } else {
            "Bot".to_string()
        };
    }
    // User ids look like `macro|<email>`; show the email's local part.
    sender_id
        .rsplit('|')
        .next()
        .unwrap_or(sender_id)
        .split('@')
        .next()
        .unwrap_or(sender_id)
        .to_string()
}

fn append_messages(prompt: &mut String, heading: &str, messages: &[ContextMessage], skip: Uuid) {
    let mut wrote_heading = false;
    for message in messages {
        if message.id == skip || message.content.trim().is_empty() {
            continue;
        }
        if !wrote_heading {
            let _ = write!(prompt, "\n{heading}\n");
            wrote_heading = true;
        }
        let _ = writeln!(
            prompt,
            "{}: {}",
            sender_label(&message.sender_id),
            message.content
        );
    }
}

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

/// Message Macro Agent posts immediately, then replaces with its answer.
const THINKING_MESSAGE: &str = "_Macro Agent is thinking…_";
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

    /// Build the prompt: who mentioned the agent, recent channel context, the
    /// thread it was mentioned in, and the triggering message.
    async fn build_prompt(&self, event: &BotEvent) -> String {
        let mentioner = sender_label(event.requesting_user.as_ref());
        let trigger_id = event.message.id;

        let recent = self
            .poster
            .recent_messages(event.channel_id, RECENT_CONTEXT_LIMIT)
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "failed to load recent channel context"))
            .unwrap_or_default();

        // Include the thread's messages when the mention happened inside a thread.
        let thread = if event.message.thread_id.is_some() {
            self.poster
                .thread_messages(event.channel_id, event.reply_thread_id)
                .await
                .inspect_err(|err| tracing::warn!(error=?err, "failed to load thread context"))
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        let mut prompt = String::new();
        let _ = writeln!(prompt, "{mentioner} mentioned you (@macro) in a channel.");
        append_messages(
            &mut prompt,
            "Recent channel messages (oldest to newest):",
            &recent,
            trigger_id,
        );
        append_messages(
            &mut prompt,
            "Messages in the thread you were mentioned in:",
            &thread,
            trigger_id,
        );
        let _ = write!(
            prompt,
            "\n{mentioner} said:\n{}\n\nReply to {mentioner}.",
            event.message.content.trim()
        );
        prompt
    }
}

#[async_trait]
impl BotHandler for MacroAiHandler {
    #[tracing::instrument(skip(self, _bot, event), fields(channel_id = %event.channel_id), err)]
    async fn handle(&self, _bot: &Bot, event: &BotEvent) -> anyhow::Result<()> {
        let actor = Sender::Bot(bot_id::MACRO_AI_BOT_ID);

        // 1. Gather conversational context (before posting, so our own
        //    "thinking" message is not included).
        let prompt = self.build_prompt(event).await;

        // 2. Post the immediate "thinking" message in the thread.
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

        // 3. Run the agent loop to produce the reply.
        let reply = match self
            .responder
            .respond(event.requesting_user.as_ref(), prompt)
            .await
        {
            Ok(text) if !text.trim().is_empty() => text,
            Ok(_) => EMPTY_RESPONSE_FALLBACK.to_string(),
            Err(err) => {
                tracing::error!(error=?err, "macro ai responder failed");
                format!("{ERROR_FALLBACK}\n\n```\n{err:#}\n```")
            }
        };

        // 4. Replace the "thinking" message with the answer.
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
