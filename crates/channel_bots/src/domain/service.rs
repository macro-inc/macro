//! Domain service for built-in channel bots.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::sync::Arc;

use channels::domain::models::{
    ParticipantRole, PatchMessageNotificationPolicy, PatchMessageRequest,
    PostMessageNotificationPolicy, PostMessageRequest, Sender,
};
use channels::domain::ports::{ChannelMutationErr, ChannelService};
use uuid::Uuid;

use super::models::{BotEvent, BotTrigger};
use super::ports::{AgentResponder, UserTimeZones};
use super::sender_label;

/// How many channel messages to include around the trigger.
///
/// Together with the trigger message itself, this yields a bounded nine-message
/// local context window.
const CONTEXT_MESSAGES_BEFORE: i64 = 4;
const CONTEXT_MESSAGES_AFTER: i64 = 4;

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

/// Render the `<current_time>` block: now in the user's primary calendar
/// time zone when one is known and parseable, UTC otherwise.
fn current_time_block(now: chrono::DateTime<chrono::Utc>, time_zone: Option<&str>) -> String {
    const FORMAT: &str = "%A, %B %-d, %Y, %-I:%M %p";
    let parsed = time_zone.map(|name| {
        (
            name,
            name.parse::<chrono_tz::Tz>().inspect_err(|error| {
                tracing::warn!(error=?error, time_zone = name, "unparseable calendar time zone");
            }),
        )
    });
    let line = match parsed {
        Some((name, Ok(tz))) => format!(
            "{} — {name}, the time zone of the user's primary calendar",
            now.with_timezone(&tz).format(FORMAT)
        ),
        // A calendar IS connected here, so the no-calendar wording would
        // mislead the model into denying the connection.
        Some((_, Err(_))) => format!(
            "{} — UTC; the user's own time zone is unknown (their calendar's time \
             zone could not be interpreted)",
            now.format(FORMAT)
        ),
        None => format!(
            "{} — UTC; the user's own time zone is unknown (no connected calendar)",
            now.format(FORMAT)
        ),
    };
    format!("\n<current_time>\n{line}\n</current_time>\n")
}

/// In-process handler for the Macro AI system bot.
///
/// Posts an immediate "thinking" reply in a thread, runs the agent loop, then
/// edits that same message with the final answer.
pub struct MacroAiHandler<C, R, Z> {
    channels: Arc<C>,
    responder: Arc<R>,
    time_zones: Arc<Z>,
}

impl<C, R, Z> MacroAiHandler<C, R, Z>
where
    C: ChannelService,
    R: AgentResponder,
    Z: UserTimeZones,
{
    /// Create a Macro AI handler.
    pub fn new(channels: Arc<C>, responder: Arc<R>, time_zones: Arc<Z>) -> Self {
        Self {
            channels,
            responder,
            time_zones,
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
            && let Some(content) = trimmed_content(&parent.content)
        {
            lines.push(PromptLine {
                sender: sender_label(&parent.sender_id),
                content,
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
            let Some(content) = trimmed_content(&reply.content) else {
                continue;
            };
            lines.push(PromptLine {
                sender: sender_label(&reply.sender_id),
                content,
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

        let (nearby, time_zone) = futures::join!(
            async {
                self.channels
                    .get_message_context(
                        event.channel_id,
                        trigger_id,
                        CONTEXT_MESSAGES_BEFORE,
                        CONTEXT_MESSAGES_AFTER,
                    )
                    .await
                    .inspect_err(
                        |err| tracing::warn!(error=?err, "failed to load local channel context"),
                    )
                    .unwrap_or_default()
            },
            self.time_zones
                .primary_time_zone(event.requesting_user.as_ref()),
        );

        let mut prompt = String::new();
        if let Some(parent_id) = event.message.thread_id {
            let (intro, thread_instruction, marker) = match event.trigger {
                BotTrigger::Mention => (
                    format!("{mentioner} mentioned you (@macro) in a channel thread."),
                    MENTION_THREAD_INSTRUCTION,
                    MENTION_TRIGGER_MARKER,
                ),
                BotTrigger::Inferred => (
                    format!(
                        "{mentioner} replied in a channel thread you are part of. They did not \
                         @-mention you, but their message appears to be addressed to you."
                    ),
                    INFERRED_THREAD_INSTRUCTION,
                    INFERRED_TRIGGER_MARKER,
                ),
            };
            let _ = writeln!(prompt, "{intro}");
            let (thread, thread_ids) = self.thread_lines(event, parent_id).await;
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
                        sender: sender_label(&message.sender_id),
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
                        sender: sender_label(&message.sender_id),
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

        prompt.push_str(&current_time_block(
            chrono::Utc::now(),
            time_zone.as_deref(),
        ));

        let _ = write!(prompt, "\nReply to {mentioner}.");
        prompt
    }

    /// React to a Macro AI mention.
    #[tracing::instrument(skip(self, event), fields(channel_id = %event.channel_id), err)]
    pub(crate) async fn handle(&self, event: &BotEvent) -> anyhow::Result<()> {
        let actor = Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID);

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
                    notification_policy: PostMessageNotificationPolicy::Silent,
                    triggered_by: Some(event.requesting_user.as_ref().to_string()),
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

        // 4. Replace the "thinking" message with the answer. A NotFound here
        //    means a participant deleted the thinking message while the agent
        //    ran — treat that as the user not wanting a response.
        match self
            .channels
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
                    notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                },
            )
            .await
        {
            Ok(()) => Ok(()),
            Err(ChannelMutationErr::NotFound(_)) => {
                tracing::info!(%message_id, "thinking message was deleted; dropping bot response");
                Ok(())
            }
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests;
