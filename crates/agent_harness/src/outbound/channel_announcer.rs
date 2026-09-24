//! Announce agent responses in their originating message thread through the shared service.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::{models::BotAccessScope, ports::EntityAccessService};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{
    AgentAnnouncementChip, AgentAnnouncementReplyTarget, AgentConnectionChip, AgentConnectionPrompt,
};
use messages::domain::{
    api::MessageCommands,
    models::{MessageAttribution, MessageParent, PostMessage, PostMessageNotificationPolicy},
    service::MessageWrite,
};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AnnouncedMessage, DeclinedMention, SessionAnnouncement, SessionBlocker,
};
use crate::domain::ports::SessionAnnouncer;

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

impl<Access: EntityAccessService> SessionAnnouncer for MessageAnnouncer<Access> {
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<AnnouncedMessage> {
        // Minted on the invoking user's current capability: an author who
        // may no longer write to the parent gets no chip posted for them.
        let access = self
            .access
            .generate_bot_entity_access_receipt::<MessageWrite>(
                announcement.bot_id,
                BotAccessScope::user(announcement.triggered_by.clone()),
                &announcement.origin_parent.entity_id(),
                announcement.origin_parent.access_entity_type(),
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        let content = self
            .lexical
            .compose_agent_announcement(
                &announcement_reply_target(&announcement),
                &announcement_chip(&announcement),
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        let posted = self
            .messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    // The chip is a pointer, not news: the thread hears
                    // about the session when it finishes or asks, through
                    // the lifecycle notifications, not when it boots.
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

    async fn decline(&self, declined: DeclinedMention) -> Result<()> {
        let access = self
            .access
            .generate_bot_entity_access_receipt::<MessageWrite>(
                declined.bot_id,
                BotAccessScope::user(declined.triggered_by),
                &declined.origin.parent.entity_id(),
                declined.origin.parent.access_entity_type(),
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
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
