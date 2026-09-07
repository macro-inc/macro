//! Domain service for built-in channel bots.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::sync::Arc;

use entity_access::domain::models::EntityAccessReceipt;
use messages::domain::{
    api::MessageServiceApi,
    models::{
        MessageParent, PatchMessageNotificationPolicy, PostMessage, PostMessageNotificationPolicy,
    },
    ports::{EditMessage, MessageError},
    service::MessageView,
};
use uuid::Uuid;

use super::models::{BotEvent, BotTrigger};
use super::ports::{AgentResponder, ConversationAccess};
use super::sender_label;

/// How many channel messages to include around the trigger.
///
/// Together with the trigger message itself, this yields a bounded nine-message
/// local context window.
const CONTEXT_MESSAGES_BEFORE: u16 = 8;

/// Inline marker appended to the sender label of the triggering message so the
/// model can tell it apart from surrounding context.
const MENTION_TRIGGER_MARKER: &str = " [this message mentioned you]";
const INFERRED_TRIGGER_MARKER: &str = " [respond to this message]";

const MENTION_THREAD_INSTRUCTION: &str = "This is the thread you were mentioned in (oldest to \
newest). Interpret the mention in the context of this thread: words like \"this\" or \"it\" in \
the mention refer to this thread unless the mention says otherwise.";

const INFERRED_THREAD_INSTRUCTION: &str = "This is the thread the message was posted in (oldest \
to newest). Interpret the message in the context of this thread: words like \"this\" or \"it\" \
refer to this thread unless the message says otherwise.";

const CHANNEL_BACKGROUND_INSTRUCTION: &str = "Other recent messages in the same channel, outside \
the thread above (oldest to newest). Background only — do not treat these as the subject of the \
triggering message.";

const CHANNEL_CONTEXT_INSTRUCTION: &str = "Recent messages in the channel around the mention \
(oldest to newest).";

/// A single message rendered into the prompt.
struct PromptLine {
    sender: String,
    content: String,
    is_trigger: bool,
}

/// Trimmed message content; `None` when the body is blank.
fn trimmed_content(content: &str) -> Option<String> {
    let trimmed = content.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The triggering message rendered from the event itself, used when the
/// trigger is missing from fetched context (e.g. a fetch failed).
fn trigger_line(event: &BotEvent) -> PromptLine {
    PromptLine {
        sender: sender_label(event.requesting_user.as_ref()),
        content: trimmed_content(&event.message.content).unwrap_or_default(),
        is_trigger: true,
    }
}

/// Write a tagged context block: an instruction line followed by one message
/// per line, labeled by sender. Skipped entirely when there are no messages.
fn append_block(
    prompt: &mut String,
    tag: &str,
    instruction: &str,
    trigger_marker: &str,
    lines: &[PromptLine],
) {
    if lines.is_empty() {
        return;
    }
    let _ = write!(prompt, "\n<{tag}>\n{instruction}\n\n");
    for line in lines {
        let marker = if line.is_trigger { trigger_marker } else { "" };
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
pub struct MacroAiHandler<R> {
    messages: Arc<dyn MessageServiceApi>,
    access: Arc<dyn ConversationAccess>,
    responder: Arc<R>,
}

impl<R> MacroAiHandler<R>
where
    R: AgentResponder,
{
    /// Create a Macro AI handler.
    pub fn new(
        messages: Arc<dyn MessageServiceApi>,
        access: Arc<dyn ConversationAccess>,
        responder: Arc<R>,
    ) -> Self {
        Self {
            messages,
            access,
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
        access: EntityAccessReceipt<MessageView>,
        parent_id: Uuid,
    ) -> anyhow::Result<(Vec<PromptLine>, HashSet<Uuid>)> {
        let thread = self.messages.get_thread(access, parent_id).await?;
        let mut thread_ids = HashSet::new();
        let mut lines = Vec::new();
        for message in std::iter::once(thread.root).chain(thread.replies) {
            thread_ids.insert(message.id);
            if message.deleted_at.is_some() {
                continue;
            }
            let Some(content) = trimmed_content(&message.content) else {
                continue;
            };
            lines.push(PromptLine {
                sender: sender_label(message.sender_id.as_ref()),
                content,
                is_trigger: message.id == event.message.message_id,
            });
        }
        if !lines.iter().any(|line| line.is_trigger) {
            lines.push(trigger_line(event));
        }
        Ok((lines, thread_ids))
    }

    /// Build the prompt for a mention.
    ///
    /// When the mention is a thread reply, the thread (parent + replies) is the
    /// primary context and nearby channel messages are demoted to a clearly
    /// labeled background block. For a top-level mention, the chronological
    /// channel slice is the primary context. In both cases the triggering
    /// message is marked inline rather than repeated at the end.
    async fn build_prompt(&self, event: &BotEvent) -> anyhow::Result<String> {
        let mentioner = sender_label(event.requesting_user.as_ref());
        let trigger_id = event.message.message_id;
        let access = self
            .access
            .user_write(&event.requesting_user, &event.message.parent)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let view = access.try_into_requirement::<MessageView>()?;
        let current = self.messages.get(view.clone(), trigger_id).await?;
        if current.deleted_at.is_some()
            || current.root_id() != event.reply_thread_id
            || current.sender_id.as_user() != Some(&event.requesting_user)
        {
            anyhow::bail!("trigger no longer belongs to this conversation");
        }
        let nearby = if matches!(event.message.parent, MessageParent::Channel(_)) {
            self.messages
                .preceding(view.clone(), trigger_id, CONTEXT_MESSAGES_BEFORE)
                .await?
        } else {
            Vec::new()
        };

        let mut prompt = format!(
            "Conversation parent: {}\n",
            serde_json::to_string(&event.message.parent)?
        );
        if let Some(parent_id) = event.message.thread_id.or_else(|| {
            event
                .message
                .parent
                .is_discussion()
                .then_some(event.message.message_id)
        }) {
            let (intro, thread_instruction, marker) = match event.trigger {
                BotTrigger::Mention => (
                    format!("{mentioner} mentioned you (@macro) in a conversation thread."),
                    MENTION_THREAD_INSTRUCTION,
                    MENTION_TRIGGER_MARKER,
                ),
                BotTrigger::Inferred => (
                    format!(
                        "{mentioner} replied in a conversation thread you are part of. They did not \
                         @-mention you, but their message appears to be addressed to you."
                    ),
                    INFERRED_THREAD_INSTRUCTION,
                    INFERRED_TRIGGER_MARKER,
                ),
            };
            let _ = writeln!(prompt, "{intro}");
            let (thread, thread_ids) = self.thread_lines(event, view, parent_id).await?;
            append_block(&mut prompt, "thread", thread_instruction, marker, &thread);

            let background: Vec<PromptLine> = nearby
                .iter()
                .filter(|message| {
                    message.deleted_at.is_none()
                        && !thread_ids.contains(&message.id)
                        && message.thread_id != Some(parent_id)
                })
                .filter_map(|message| {
                    Some(PromptLine {
                        sender: sender_label(message.sender_id.as_ref()),
                        content: trimmed_content(&message.content)?,
                        is_trigger: false,
                    })
                })
                .collect();
            append_block(
                &mut prompt,
                "channel_background",
                CHANNEL_BACKGROUND_INSTRUCTION,
                marker,
                &background,
            );
        } else {
            let _ = writeln!(prompt, "{mentioner} mentioned you (@macro) in a channel.");
            let mut lines: Vec<PromptLine> = nearby
                .iter()
                .filter(|message| message.deleted_at.is_none())
                .filter_map(|message| {
                    Some(PromptLine {
                        sender: sender_label(message.sender_id.as_ref()),
                        content: trimmed_content(&message.content)?,
                        is_trigger: message.id == trigger_id,
                    })
                })
                .collect();
            if !lines.iter().any(|line| line.is_trigger) {
                lines.push(trigger_line(event));
            }
            append_block(
                &mut prompt,
                "channel_context",
                CHANNEL_CONTEXT_INSTRUCTION,
                MENTION_TRIGGER_MARKER,
                &lines,
            );
        }

        let _ = write!(prompt, "\nReply to {mentioner}.");
        Ok(prompt)
    }

    /// React to a Macro AI mention.
    #[tracing::instrument(skip(self, event), fields(parent = ?event.message.parent), err)]
    pub(crate) async fn handle(&self, event: &BotEvent) -> anyhow::Result<()> {
        let prompt = self.build_prompt(event).await?;
        let access = self
            .access
            .bot_write(&event.requesting_user, &event.message.parent)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let thinking = self
            .messages
            .post(
                access,
                PostMessage {
                    attribution: Default::default(),
                    content: THINKING_MESSAGE.to_string(),
                    mentions: Vec::new(),
                    thread_id: Some(event.reply_thread_id),
                    anchor: None,
                    attachments: Vec::new(),
                    nonce: None,
                    notification_policy: PostMessageNotificationPolicy::Silent,
                },
            )
            .await?;
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
        let access = self
            .access
            .bot_write(&event.requesting_user, &event.message.parent)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        match self
            .messages
            .edit(
                access,
                thinking.id,
                EditMessage {
                    content: reply,
                    mentions: Vec::new(),
                    attachments: None,
                    nonce: None,
                    notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                },
            )
            .await
        {
            Ok(_) | Err(MessageError::NotFound) => Ok(()),
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests;
