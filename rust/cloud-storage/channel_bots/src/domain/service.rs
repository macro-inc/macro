//! Domain service for built-in channel bots.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::sync::Arc;

use channels::domain::models::{ParticipantRole, PatchMessageRequest, PostMessageRequest, Sender};
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

/// Inline marker appended to the sender label of the triggering message so the
/// model can tell it apart from surrounding context.
const TRIGGER_MARKER: &str = " [this message mentioned you]";

const THREAD_INSTRUCTION: &str = "This is the thread you were mentioned in (oldest to newest). \
Interpret the mention in the context of this thread: words like \"this\" or \"it\" in the \
mention refer to this thread unless the mention says otherwise.";

const CHANNEL_BACKGROUND_INSTRUCTION: &str = "Other recent messages in the same channel, outside \
the thread above (oldest to newest). Background only — do not treat these as the subject of the \
mention.";

const CHANNEL_CONTEXT_INSTRUCTION: &str = "Recent messages in the channel around the mention \
(oldest to newest).";

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

/// A single message rendered into the prompt.
struct PromptLine {
    sender: String,
    content: String,
    is_trigger: bool,
}

/// The triggering message rendered from the event itself, used when the
/// trigger is missing from fetched context (e.g. a fetch failed).
fn trigger_line(event: &BotEvent) -> PromptLine {
    PromptLine {
        sender: sender_label(event.requesting_user.as_ref()),
        content: event.message.content.trim().to_string(),
        is_trigger: true,
    }
}

/// Write a tagged context block: an instruction line followed by one message
/// per line, labeled by sender. Skipped entirely when there are no messages.
fn append_block(prompt: &mut String, tag: &str, instruction: &str, lines: &[PromptLine]) {
    if lines.is_empty() {
        return;
    }
    let _ = write!(prompt, "\n<{tag}>\n{instruction}\n\n");
    for line in lines {
        let marker = if line.is_trigger { TRIGGER_MARKER } else { "" };
        let _ = writeln!(prompt, "{}{marker}: {}", line.sender, line.content);
    }
    let _ = writeln!(prompt, "</{tag}>");
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

    /// Load the thread the mention belongs to as prompt lines: the top-level
    /// parent followed by all replies in order, with the triggering message
    /// marked inline. Also returns the ids of every message known to belong to
    /// the thread so they can be excluded from the channel background.
    async fn thread_lines(
        &self,
        event: &BotEvent,
        parent_id: Uuid,
    ) -> (Vec<PromptLine>, HashSet<Uuid>) {
        let mut thread_ids = HashSet::from([parent_id, event.message.id]);
        let mut lines = Vec::new();

        let parent = self
            .channels
            .get_message_context(event.channel_id, parent_id, 0, 0)
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "failed to load thread parent"))
            .unwrap_or_default()
            .into_iter()
            .find(|message| message.id == parent_id);
        if let Some(parent) = parent
            && parent.deleted_at.is_none()
            && !parent.content.trim().is_empty()
        {
            lines.push(PromptLine {
                sender: sender_label(&parent.sender_id),
                content: parent.content.trim().to_string(),
                is_trigger: false,
            });
        }

        let replies = self
            .channels
            .get_thread_replies(event.channel_id, parent_id)
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "failed to load thread replies"))
            .unwrap_or_default();
        for reply in replies {
            thread_ids.insert(reply.id);
            if reply.content.trim().is_empty() {
                continue;
            }
            lines.push(PromptLine {
                sender: sender_label(&reply.sender_id),
                content: reply.content.trim().to_string(),
                is_trigger: reply.id == event.message.id,
            });
        }
        if !lines.iter().any(|line| line.is_trigger) {
            lines.push(trigger_line(event));
        }
        (lines, thread_ids)
    }

    /// Build the prompt for a mention.
    ///
    /// When the mention is a thread reply, the thread (parent + replies) is the
    /// primary context and nearby channel messages are demoted to a clearly
    /// labeled background block. For a top-level mention, the chronological
    /// channel slice is the primary context. In both cases the triggering
    /// message is marked inline rather than repeated at the end.
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
        if let Some(parent_id) = event.message.thread_id {
            let _ = writeln!(
                prompt,
                "{mentioner} mentioned you (@macro) in a channel thread."
            );
            let (thread, thread_ids) = self.thread_lines(event, parent_id).await;
            append_block(&mut prompt, "thread", THREAD_INSTRUCTION, &thread);

            let background: Vec<PromptLine> = nearby
                .iter()
                .filter(|message| {
                    message.deleted_at.is_none()
                        && !message.content.trim().is_empty()
                        && !thread_ids.contains(&message.id)
                        && message.thread_id != Some(parent_id)
                })
                .map(|message| PromptLine {
                    sender: sender_label(&message.sender_id),
                    content: message.content.trim().to_string(),
                    is_trigger: false,
                })
                .collect();
            append_block(
                &mut prompt,
                "channel_background",
                CHANNEL_BACKGROUND_INSTRUCTION,
                &background,
            );
        } else {
            let _ = writeln!(prompt, "{mentioner} mentioned you (@macro) in a channel.");
            let mut lines: Vec<PromptLine> = nearby
                .iter()
                .filter(|message| {
                    message.deleted_at.is_none() && !message.content.trim().is_empty()
                })
                .map(|message| PromptLine {
                    sender: sender_label(&message.sender_id),
                    content: message.content.trim().to_string(),
                    is_trigger: message.id == trigger_id,
                })
                .collect();
            if !lines.iter().any(|line| line.is_trigger) {
                lines.push(trigger_line(event));
            }
            append_block(
                &mut prompt,
                "channel_context",
                CHANNEL_CONTEXT_INSTRUCTION,
                &lines,
            );
        }

        let _ = write!(prompt, "\nReply to {mentioner}.");
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
