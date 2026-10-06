//! Trigger detection for candidate channel messages.

use std::sync::Arc;

use ai_billing::{AiAdmissionService, AiFeature, DisabledAiAdmissionService};
use async_trait::async_trait;
use messages::domain::{api::MessageReader, events::MessagePostedMetadata};
use uuid::Uuid;

use super::models::{BotInvocation, BotTrigger, TranscriptMessage};
use super::ports::{ConversationAccess, InferredTriggerClassifier, TriggerDetector};
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
/// Attributed bot messages require an explicit mention of another bot;
/// classifier failures resolve to no trigger.
pub struct MentionOrInferredDetector<I> {
    messages: Arc<dyn MessageReader>,
    access: Arc<dyn ConversationAccess>,
    classifier: Arc<I>,
    admission: Arc<dyn AiAdmissionService>,
}

impl<I> MentionOrInferredDetector<I>
where
    I: InferredTriggerClassifier,
{
    /// Create a detector from the channel read service and a classifier.
    pub fn new(
        messages: Arc<dyn MessageReader>,
        access: Arc<dyn ConversationAccess>,
        classifier: Arc<I>,
    ) -> Self {
        Self {
            messages,
            access,
            classifier,
            admission: Arc::new(DisabledAiAdmissionService),
        }
    }

    /// Configure admission for optional inference; explicit mentions need no model.
    pub fn with_admission(mut self, admission: Arc<dyn AiAdmissionService>) -> Self {
        self.admission = admission;
        self
    }

    /// Load the thread (parent + replies, oldest-first) as a transcript. The
    /// candidate message is appended if the reply fetch does not include it
    /// yet.
    async fn thread_transcript(
        &self,
        candidate: &MessagePostedMetadata,
        parent_id: Uuid,
    ) -> anyhow::Result<Vec<TranscriptMessage>> {
        let user = candidate
            .sender
            .as_user()
            .ok_or_else(|| anyhow::anyhow!("only users invoke agents"))?;
        let access = self
            .access
            .user_write(user, &candidate.parent)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let view = access.try_into_requirement()?;
        let current = self
            .messages
            .get(view.clone(), candidate.message_id)
            .await?;
        if current.deleted_at.is_some()
            || current.root_id() != parent_id
            || current.sender_id != candidate.sender
        {
            anyhow::bail!("invalid trigger origin");
        }
        let thread = self.messages.get_thread(view, parent_id).await?;
        let mut transcript = Vec::new();
        for message in std::iter::once(thread.root).chain(thread.replies) {
            if message.deleted_at.is_none() && !message.content.trim().is_empty() {
                transcript.push(transcript_message(
                    message.sender_id.as_ref(),
                    &message.content,
                ));
            }
        }
        Ok(transcript)
    }

    async fn infer(&self, candidate: &MessagePostedMetadata) -> Option<BotInvocation> {
        let requesting_user = candidate.sender.as_user()?;
        let parent_id = candidate.thread_id?;

        let transcript = self
            .thread_transcript(candidate, parent_id)
            .await
            .inspect_err(|err| tracing::warn!(error=?err, "unable to load authorized bot thread"))
            .ok()?;
        if !transcript.iter().any(|message| message.from_agent) {
            return None;
        }

        self.admission
            .admit(requesting_user, AiFeature::ChannelBot)
            .await
            .inspect_err(|error| {
                tracing::info!(code = error.code(), "skipping bot trigger inference");
            })
            .ok()?;

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
impl<I> TriggerDetector for MentionOrInferredDetector<I>
where
    I: InferredTriggerClassifier,
{
    async fn detect(&self, candidate: &MessagePostedMetadata) -> Vec<BotInvocation> {
        let Some(user) = candidate.invoking_user() else {
            return Vec::new();
        };
        if self
            .access
            .user_write(&user, &candidate.parent)
            .await
            .is_err()
        {
            return Vec::new();
        }
        let mentioned = messages::domain::mentions::bot_mention_ids(&candidate.mentions);
        if !mentioned.is_empty() {
            return mentioned
                .into_iter()
                .filter(|bot_id| {
                    candidate.sender.as_bot().map(|sender| sender.bot_id()) != Some(*bot_id)
                })
                .map(|bot_id| BotInvocation {
                    bot_id,
                    trigger: BotTrigger::Mention,
                })
                .collect();
        }
        self.infer(candidate).await.into_iter().collect()
    }
}

#[cfg(test)]
mod tests;
