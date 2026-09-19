//! Trigger detection for candidate channel messages.

use std::sync::Arc;

use async_trait::async_trait;
use channels::domain::ports::ChannelService;
use channels::domain::side_effects::ChannelBotTrigger;
use uuid::Uuid;

use super::models::{BotInvocation, BotTrigger, TranscriptMessage};
use super::ports::{InferredTriggerClassifier, TriggerDetector};
use super::sender_label;

/// Detects both explicit `@`-mention triggers and inferred triggers.
///
/// A message that mentions bots triggers exactly those bots. A message that
/// mentions none is considered for an inferred Macro AI trigger, which fires
/// only when all of the following hold:
///
/// * the message is a thread reply (never a top-level message),
/// * the thread already contains a Macro AI message,
/// * the classifier judges that the message expects an agent response.
///
/// Bot-authored messages never trigger anything; classifier failures resolve
/// to no trigger.
pub struct MentionOrInferredDetector<C, I> {
    channels: Arc<C>,
    classifier: Arc<I>,
}

impl<C, I> MentionOrInferredDetector<C, I>
where
    C: ChannelService,
    I: InferredTriggerClassifier,
{
    /// Create a detector from the channel read service and a classifier.
    pub fn new(channels: Arc<C>, classifier: Arc<I>) -> Self {
        Self {
            channels,
            classifier,
        }
    }

    /// Load the thread (parent + replies, oldest-first) as a transcript. The
    /// candidate message is appended if the reply fetch does not include it
    /// yet.
    async fn thread_transcript(
        &self,
        candidate: &ChannelBotTrigger,
        parent_id: Uuid,
    ) -> Vec<TranscriptMessage> {
        let mut transcript = Vec::new();

        let parent = self
            .channels
            .get_message_context(candidate.channel_id, parent_id, 0, 0)
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "failed to load thread parent"))
            .unwrap_or_default()
            .into_iter()
            .find(|message| message.id == parent_id);
        if let Some(parent) = parent
            && parent.deleted_at.is_none()
            && !parent.content.trim().is_empty()
        {
            transcript.push(transcript_message(&parent.sender_id, &parent.content));
        }

        let replies = self
            .channels
            .get_thread_replies(candidate.channel_id, parent_id)
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "failed to load thread replies"))
            .unwrap_or_default();
        let mut candidate_included = false;
        for reply in replies {
            if reply.content.trim().is_empty() {
                continue;
            }
            candidate_included |= reply.id == candidate.message.id;
            transcript.push(transcript_message(&reply.sender_id, &reply.content));
        }
        if !candidate_included {
            transcript.push(transcript_message(
                candidate.message.sender_id.as_ref(),
                &candidate.message.content,
            ));
        }
        transcript
    }

    async fn infer(&self, candidate: &ChannelBotTrigger) -> Option<BotInvocation> {
        let requesting_user = candidate.message.sender_id.as_user()?;
        let parent_id = candidate.message.thread_id?;

        let transcript = self.thread_transcript(candidate, parent_id).await;
        if !transcript.iter().any(|message| message.from_agent) {
            return None;
        }

        match self
            .classifier
            .expects_response(requesting_user, &transcript)
            .await
        {
            Ok(true) => Some(BotInvocation {
                bot_id: bot_id::MACRO_AI_BOT_ID,
                trigger: BotTrigger::Inferred,
            }),
            Ok(false) => None,
            Err(err) => {
                tracing::warn!(error=?err, "inferred trigger classification failed");
                None
            }
        }
    }
}

fn transcript_message(sender_id: &str, content: &str) -> TranscriptMessage {
    let from_agent = bot_id::BotIdStr::parse_from_str(sender_id)
        .is_ok_and(|bot| bot.bot_id() == bot_id::MACRO_AI_BOT_ID);
    TranscriptMessage {
        from_agent,
        sender: sender_label(sender_id),
        content: content.trim().to_string(),
    }
}

#[async_trait]
impl<C, I> TriggerDetector for MentionOrInferredDetector<C, I>
where
    C: ChannelService,
    I: InferredTriggerClassifier,
{
    async fn detect(&self, candidate: &ChannelBotTrigger) -> Vec<BotInvocation> {
        if candidate.message.sender_id.as_user().is_none() {
            return Vec::new();
        }
        if !candidate.mentioned_bot_ids.is_empty() {
            return candidate
                .mentioned_bot_ids
                .iter()
                .map(|bot_id| BotInvocation {
                    bot_id: *bot_id,
                    trigger: BotTrigger::Mention,
                })
                .collect();
        }
        self.infer(candidate).await.into_iter().collect()
    }
}

#[cfg(test)]
mod tests;
