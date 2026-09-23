//! Speak for an agent session in its originating thread through the shared
//! message service.
//!
//! Two shapes, by the session's [`AgentKind`]: a coding agent's turn is a
//! magic chip Lexical composes, a live portal into the session that renders
//! the turn itself; a chat agent's turn is a pending reply - the channel
//! markdown's pulsing await node - that is patched into the answer when the
//! turn ends, the way the original Macro bot replied. The domain names the
//! kind; nothing about either node's syntax leaves this module.

#[cfg(test)]
mod test;

use std::sync::Arc;

use bot_id::BotId;
use entity_access::domain::{
    models::{BotAccessScope, EntityAccessReceipt},
    ports::EntityAccessService,
};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{
    AgentAnnouncementChip, AgentAnnouncementReplyTarget, AgentConnectionChip, AgentConnectionPrompt,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageCommands,
    models::{
        MessageAttribution, MessageParent, PatchMessageNotificationPolicy, PostMessage,
        PostMessageNotificationPolicy,
    },
    ports::{MessageError, MessagePatch},
    service::MessageWrite,
};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AnnouncedMessage, DeclinedMention, ReplyOutcome, ResolvedReply, SessionAnnouncement,
    SessionBlocker,
};
use crate::domain::ports::SessionAnnouncer;

/// A chat agent's message while its turn runs, replaced by the answer.
///
/// Rendered by the channel markdown as the pulsing await node, like the
/// original Macro bot's.
const PENDING_REPLY: &str = r#"<m-await>{"text":"Thinking…","inline":true}</m-await>"#;
const EMPTY_RESPONSE_FALLBACK: &str = "I wasn't able to come up with a response.";
const CANCELLED_FALLBACK: &str = "I stopped before finishing that.";
const ERROR_FALLBACK: &str = "Sorry — I ran into an error while responding.";

/// What a chat agent's pending reply becomes. Never blank: a turn that said
/// nothing is told as such rather than left as an empty message.
fn reply_content(outcome: ReplyOutcome) -> String {
    match outcome {
        ReplyOutcome::Answered(text) => text,
        ReplyOutcome::Empty => EMPTY_RESPONSE_FALLBACK.to_owned(),
        ReplyOutcome::Cancelled => CANCELLED_FALLBACK.to_owned(),
        ReplyOutcome::Failed => ERROR_FALLBACK.to_owned(),
    }
}

/// Describe the missing setup; Lexical owns the message and chip serialization.
fn connection_prompt(blocker: SessionBlocker) -> AgentConnectionPrompt {
    let (agent_tag, message, app_slug, name) = match blocker {
        SessionBlocker::CursorNotConnected => (
            "@cursor",
            "runs on your own Cursor account, and yours is not connected yet. Add your Cursor API key, then mention me again.",
            "cursor",
            "Cursor",
        ),
        SessionBlocker::CodexNotConnected => (
            "@codex",
            "runs on your own ChatGPT account. Connect Codex and select a cloud environment, then mention me again.",
            "codex-cloud",
            "Codex",
        ),
        SessionBlocker::CodexEnvironmentNotConfigured => (
            "@codex",
            "needs a cloud environment to run. Select an environment in Codex settings, then mention me again.",
            "codex-cloud",
            "Codex",
        ),
        SessionBlocker::ClaudeNotConnected => (
            "@claude",
            "runs on your own Claude account. Connect Claude, then mention me again.",
            "claude-cloud",
            "Claude",
        ),
    };
    AgentConnectionPrompt {
        agent_tag: agent_tag.to_owned(),
        message: message.to_owned(),
        chip: AgentConnectionChip {
            app_slug: app_slug.to_owned(),
            name: name.to_owned(),
            target: "harness".to_owned(),
        },
    }
}

fn announcement_chip(announcement: &SessionAnnouncement) -> AgentAnnouncementChip {
    AgentAnnouncementChip {
        agent_session_id: announcement.session_id.to_string(),
        channel_id: None,
        prompted_message: announcement.prompted_message_id,
        status: "booting".to_owned(),
    }
}

fn announcement_reply_target(announcement: &SessionAnnouncement) -> AgentAnnouncementReplyTarget {
    AgentAnnouncementReplyTarget {
        parent: announcement.origin_parent.clone(),
        channel_id: match &announcement.origin_parent {
            MessageParent::Channel(channel_id) => Some(channel_id.to_string()),
            MessageParent::Document(_) => None,
        },
        target_message_id: announcement.origin_message_id.to_string(),
        target_thread_id: announcement.origin_thread_id.to_string(),
        display_text: announcement.prompted_content.clone(),
        sender_id: announcement.triggered_by.as_ref().to_owned(),
    }
}

/// Posts as the session bot with the invoking user's current parent capability.
pub struct MessageAnnouncer<Access> {
    messages: Arc<dyn MessageCommands>,
    access: Arc<Access>,
    lexical: LexicalClient,
}

impl<Access> MessageAnnouncer<Access> {
    /// Compose the common message service, authorization service, and Markdown composer.
    pub fn new(
        messages: Arc<dyn MessageCommands>,
        access: Arc<Access>,
        lexical: LexicalClient,
    ) -> Self {
        Self {
            messages,
            access,
            lexical,
        }
    }
}

impl<Access: EntityAccessService> MessageAnnouncer<Access> {
    /// The bot's capability to write into `parent`, minted on the invoking
    /// user's current one: an author who may no longer write there gets
    /// nothing posted or patched in their name.
    async fn bot_write(
        &self,
        bot_id: BotId,
        user: MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>> {
        self.access
            .generate_bot_entity_access_receipt::<MessageWrite>(
                bot_id,
                BotAccessScope::user(user),
                &parent.entity_id(),
                parent.access_entity_type(),
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))
    }
}

impl<Access: EntityAccessService> SessionAnnouncer for MessageAnnouncer<Access> {
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<AnnouncedMessage> {
        let access = self
            .bot_write(
                announcement.bot_id,
                announcement.triggered_by.clone(),
                &announcement.origin_parent,
            )
            .await?;
        let content = if announcement.kind.is_coding() {
            self.lexical
                .compose_agent_announcement(
                    &announcement_reply_target(&announcement),
                    &announcement_chip(&announcement),
                )
                .await
                .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?
        } else {
            PENDING_REPLY.to_owned()
        };
        let posted = self
            .messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    // Neither shape is news yet. The chip is a pointer: the
                    // thread hears about the session when it finishes or
                    // asks, through the lifecycle notifications. The
                    // pending reply notifies when it is resolved into the
                    // answer, as the answer.
                    notification_policy: PostMessageNotificationPolicy::Silent,
                    content,
                    thread_id: Some(announcement.origin_thread_id),
                    anchor: None,
                    mentions: Vec::new(),
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        Ok(AnnouncedMessage {
            message_id: posted.id,
        })
    }

    async fn resolve(&self, resolution: ResolvedReply) -> Result<()> {
        if resolution.kind.is_coding() {
            return Ok(());
        }
        let access = self
            .bot_write(
                resolution.bot_id,
                resolution.triggered_by,
                &resolution.origin_parent,
            )
            .await?;
        let message_id = resolution.message_id;
        match self
            .messages
            .patch(
                access,
                message_id,
                MessagePatch {
                    content: Some(reply_content(resolution.outcome)),
                    // The answer is the news the pending reply withheld.
                    notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                    ..Default::default()
                },
            )
            .await
        {
            Ok(_) => Ok(()),
            // A participant deleted the pending reply while the agent ran:
            // they did not want the answer, and there is nowhere to put it.
            Err(MessageError::NotFound) => {
                tracing::info!(%message_id, "pending reply was deleted; dropping the answer");
                Ok(())
            }
            Err(error) => Err(HarnessError::Announce(rootcause::report!(error).into())),
        }
    }

    async fn decline(&self, declined: DeclinedMention) -> Result<()> {
        let access = self
            .bot_write(
                declined.bot_id,
                declined.triggered_by,
                &declined.origin.parent,
            )
            .await?;
        let content = self
            .lexical
            .compose_agent_connection_prompt(&connection_prompt(declined.blocker))
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        self.messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    anchor: None,
                    content,
                    mentions: Vec::new(),
                    thread_id: Some(declined.origin.thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    // Unlike a session chip, this is the whole answer: the
                    // person who asked should hear it even if they have
                    // already looked away from the thread.
                    notification_policy: PostMessageNotificationPolicy::Default,
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        Ok(())
    }
}
