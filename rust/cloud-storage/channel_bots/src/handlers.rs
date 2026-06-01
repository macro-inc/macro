//! Bot trigger events and the built-in handlers.

use std::fmt::Write as _;
use std::sync::Arc;

use async_trait::async_trait;
use channels::domain::models::{
    MutatedMessage, ParticipantRole, PatchMessageRequest, PostMessageRequest, Sender,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::poster::{ChannelBotPoster, ContextMessage};
use crate::responder::AgentResponder;

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

/// A normalized trigger delivered to a system bot handler.
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

/// Handles a trigger for a system bot. System bots are defined in code and
/// require no database row, so the handler is given only the event.
#[async_trait]
pub trait SystemBotHandler: Send + Sync {
    /// React to a trigger for this system bot.
    async fn handle(&self, event: &BotEvent) -> anyhow::Result<()>;
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
pub struct MacroAiHandler {
    poster: Arc<dyn ChannelBotPoster>,
    responder: Arc<dyn AgentResponder>,
}

impl MacroAiHandler {
    /// Create a Macro AI handler.
    pub fn new(poster: Arc<dyn ChannelBotPoster>, responder: Arc<dyn AgentResponder>) -> Self {
        Self { poster, responder }
    }

    /// Build the prompt: who mentioned the agent, local channel context around
    /// the triggering message, and the triggering message itself.
    async fn build_prompt(&self, event: &BotEvent) -> String {
        let mentioner = sender_label(event.requesting_user.as_ref());
        let trigger_id = event.message.id;

        let nearby = self
            .poster
            .messages_around(
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
}

#[async_trait]
impl SystemBotHandler for MacroAiHandler {
    #[tracing::instrument(skip(self, event), fields(channel_id = %event.channel_id), err)]
    async fn handle(&self, event: &BotEvent) -> anyhow::Result<()> {
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
                ERROR_FALLBACK.to_string()
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

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use chrono::Utc;

    use super::*;

    struct TestPoster {
        around_args: Mutex<Option<(Uuid, Uuid, i64, i64)>>,
        around_messages: Vec<ContextMessage>,
    }

    #[async_trait]
    impl ChannelBotPoster for TestPoster {
        async fn post_message(
            &self,
            _actor: Sender,
            _channel_id: Uuid,
            _req: PostMessageRequest,
        ) -> anyhow::Result<channels::domain::models::PostMessageResponse> {
            unimplemented!("not needed for prompt tests")
        }

        async fn patch_message(
            &self,
            _actor: Sender,
            _actor_role: ParticipantRole,
            _channel_id: Uuid,
            _message_id: Uuid,
            _req: PatchMessageRequest,
        ) -> anyhow::Result<()> {
            unimplemented!("not needed for prompt tests")
        }

        async fn messages_around(
            &self,
            channel_id: Uuid,
            message_id: Uuid,
            before: i64,
            after: i64,
        ) -> anyhow::Result<Vec<ContextMessage>> {
            *self.around_args.lock().unwrap() = Some((channel_id, message_id, before, after));
            Ok(self.around_messages.clone())
        }
    }

    struct TestResponder;

    #[async_trait]
    impl AgentResponder for TestResponder {
        async fn respond(&self, _user_id: &str, _prompt: String) -> anyhow::Result<String> {
            unimplemented!("not needed for prompt tests")
        }
    }

    fn user_id(email: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
    }

    #[tokio::test]
    async fn prompt_uses_local_context_around_trigger() {
        let channel_id = Uuid::new_v4();
        let trigger_id = Uuid::new_v4();
        let before_id = Uuid::new_v4();
        let after_id = Uuid::new_v4();
        let poster = Arc::new(TestPoster {
            around_args: Mutex::new(None),
            around_messages: vec![
                ContextMessage {
                    id: before_id,
                    sender_id: "macro|alice@example.com".to_string(),
                    content: "before".to_string(),
                },
                ContextMessage {
                    id: trigger_id,
                    sender_id: "macro|teo@example.com".to_string(),
                    content: "@macro help".to_string(),
                },
                ContextMessage {
                    id: after_id,
                    sender_id: "macro|bob@example.com".to_string(),
                    content: "after".to_string(),
                },
            ],
        });
        let handler = MacroAiHandler::new(poster.clone(), Arc::new(TestResponder));
        let event = BotEvent {
            trigger: BotTrigger::Mention,
            channel_id,
            message: MutatedMessage {
                id: trigger_id,
                channel_id,
                thread_id: None,
                sender_id: Sender::User(user_id("teo@example.com")),
                content: "@macro help".to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                edited_at: None,
                deleted_at: None,
            },
            reply_thread_id: trigger_id,
            requesting_user: user_id("teo@example.com"),
        };

        let prompt = handler.build_prompt(&event).await;

        assert_eq!(
            *poster.around_args.lock().unwrap(),
            Some((
                channel_id,
                trigger_id,
                CONTEXT_MESSAGES_BEFORE,
                CONTEXT_MESSAGES_AFTER
            ))
        );
        assert!(prompt.contains("Channel messages around the mention"));
        assert!(prompt.contains("alice: before"));
        assert!(prompt.contains("bob: after"));
        assert!(!prompt.contains("teo: @macro help"));
        assert!(prompt.contains("teo said:\n@macro help"));
        assert!(!prompt.contains("Recent channel messages"));
        assert!(!prompt.contains("Messages in the thread"));
    }
}
