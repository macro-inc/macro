//! Trigger detection for candidate channel messages.

use std::sync::Arc;

use ai_billing::{AiAdmissionService, AiFeature, DisabledAiAdmissionService};
use async_trait::async_trait;
use channel_sender::ChannelSender;
use entity_access::domain::models::EntityAccessReceipt;
use messages::domain::{
    agent_hops::{MAX_AGENT_HOPS, agent_hops},
    api::MessageReader,
    events::MessagePostedMetadata,
    models::Message,
    service::MessageWrite,
};
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
/// Attributed bot messages trigger like a person's, within the agent hop
/// limit and never their own bot; unattributed bot messages trigger nothing.
/// Classifier failures resolve to no trigger.
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
            .invoking_user()
            .ok_or_else(|| anyhow::anyhow!("nobody invoked this message"))?;
        let access = self
            .access
            .user_write(&user, &candidate.parent)
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
                transcript.push(transcript_message(&message));
            }
        }
        Ok(transcript)
    }

    /// Whether a bot's mention stays within [`MAX_AGENT_HOPS`] of the last
    /// person in its thread. An unreadable thread counts as over the limit.
    async fn within_hop_limit(
        &self,
        candidate: &MessagePostedMetadata,
        access: EntityAccessReceipt<MessageWrite>,
    ) -> bool {
        let thread: anyhow::Result<_> = async {
            let view = access.try_into_requirement()?;
            Ok(self.messages.get_thread(view, candidate.root_id).await?)
        }
        .await;
        let thread = match thread {
            Ok(thread) => thread,
            Err(error) => {
                tracing::warn!(error = ?error, "thread read failed; not counting agent hops");
                return false;
            }
        };
        let senders: Vec<&ChannelSender<'static>> = std::iter::once(&thread.root)
            .chain(&thread.replies)
            .take_while(|message| message.id != candidate.message_id)
            .map(|message| &message.sender_id)
            .chain(std::iter::once(&candidate.sender))
            .collect();
        let hops = agent_hops(senders.into_iter());
        if hops > MAX_AGENT_HOPS {
            tracing::info!(
                message_id = %candidate.message_id,
                hops,
                "bot mention exceeds the agent hop limit; not invoking"
            );
            return false;
        }
        true
    }

    /// Macro AI never infers a reply to its own message.
    async fn infer(&self, candidate: &MessagePostedMetadata) -> Option<BotInvocation> {
        if candidate.sender.as_bot().map(|sender| sender.bot_id()) == Some(bot_id::MACRO_AI_BOT_ID)
        {
            return None;
        }
        let requesting_user = candidate.invoking_user()?;
        let requesting_user = &requesting_user;
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

/// Macro AI's messages are the agent's; other bots go by their public name.
fn transcript_message(message: &Message) -> TranscriptMessage {
    let from_agent =
        message.sender_id.as_bot().map(|bot| bot.bot_id()) == Some(bot_id::MACRO_AI_BOT_ID);
    let sender = match &message.bot_profile {
        Some(profile) if !from_agent => profile.name.clone(),
        _ => sender_label(message.sender_id.as_ref()),
    };
    TranscriptMessage {
        from_agent,
        sender,
        content: message.content.trim().to_string(),
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
        let Ok(access) = self.access.user_write(&user, &candidate.parent).await else {
            return Vec::new();
        };
        if candidate.sender.as_bot().is_some() && !self.within_hop_limit(candidate, access).await {
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
