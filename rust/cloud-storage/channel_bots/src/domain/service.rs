//! Domain service for built-in channel bots.

use std::fmt::Write as _;
use std::sync::Arc;

use channels::domain::models::{
    ChannelContextMessage, ParticipantRole, PatchMessageRequest, PostMessageRequest, Sender,
};
use channels::domain::ports::ChannelService;
use uuid::Uuid;

use super::models::BotEvent;
use super::ports::AgentResponder;

/// How many channel messages to include around the trigger.
///
/// Together with the trigger message itself, this yields a bounded nine-message
/// local context window.
const CONTEXT_MESSAGES_BEFORE: i64 = 4;
const CONTEXT_MESSAGES_AFTER: i64 = 4;

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

fn append_messages(
    prompt: &mut String,
    heading: &str,
    messages: &[ChannelContextMessage],
    skip: Uuid,
) {
    let mut wrote_heading = false;
    for message in messages {
        if message.id == skip || message.deleted_at.is_some() || message.content.trim().is_empty() {
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

/// Message Macro posts immediately, then replaces with its answer.
///
/// Rendered by the channel markdown as the existing pulsing AwaitNode.
const THINKING_MESSAGE: &str = r#"<m-await>{"text":"Macro is thinking…","inline":true}</m-await>"#;
const EMPTY_RESPONSE_FALLBACK: &str = "I wasn't able to come up with a response.";
const ERROR_FALLBACK: &str = "Sorry — I ran into an error while responding.";

/// In-process handler for the Macro AI system bot.
///
/// Posts an immediate "thinking" reply in a thread, runs the agent loop, then
/// edits that same message with the final answer.
pub struct MacroAiHandler<C, R> {
    channels: Arc<C>,
    responder: Arc<R>,
}

impl<C, R> MacroAiHandler<C, R>
where
    C: ChannelService,
    R: AgentResponder,
{
    /// Create a Macro AI handler.
    pub fn new(channels: Arc<C>, responder: Arc<R>) -> Self {
        Self {
            channels,
            responder,
        }
    }

    /// Build the prompt: who mentioned the agent, local channel context around
    /// the triggering message, and the triggering message itself.
    async fn build_prompt(&self, event: &BotEvent) -> String {
        let mentioner = sender_label(event.requesting_user.as_ref());
        let trigger_id = event.message.id;

        let nearby = self
            .channels
            .get_message_context(
                event.channel_id,
                trigger_id,
                CONTEXT_MESSAGES_BEFORE,
                CONTEXT_MESSAGES_AFTER,
            )
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "failed to load local channel context"))
            .unwrap_or_default();

        let mut prompt = String::new();
        let _ = writeln!(prompt, "{mentioner} mentioned you (@macro) in a channel.");
        append_messages(
            &mut prompt,
            "Channel messages around the mention (oldest to newest):",
            &nearby,
            trigger_id,
        );
        let _ = write!(
            prompt,
            "\n{mentioner} said:\n{}\n\nReply to {mentioner}.",
            event.message.content.trim()
        );
        prompt
    }

    /// React to a Macro AI mention.
    #[tracing::instrument(skip(self, event), fields(channel_id = %event.channel_id), err)]
    pub(crate) async fn handle(&self, event: &BotEvent) -> anyhow::Result<()> {
        let actor = Sender::Bot(bot_id::MACRO_AI_BOT_ID);

        // 1. Gather conversational context (before posting, so our own
        //    "thinking" message is not included).
        let prompt = self.build_prompt(event).await;

        // 2. Post the immediate "thinking" message in the thread.
        let thinking = self
            .channels
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
                ERROR_FALLBACK.to_string()
            }
        };

        // 4. Replace the "thinking" message with the answer.
        self.channels
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

#[cfg(test)]
mod tests;
