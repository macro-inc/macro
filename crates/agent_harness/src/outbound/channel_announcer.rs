//! Announce agent responses in their originating message thread through the shared service.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_egress::domain::model::CONNECT_APP_TAG;
use entity_access::domain::{models::BotAccessScope, ports::EntityAccessService};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{AgentAnnouncementChip, AgentAnnouncementReplyTarget};
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

/// The message a declined mention becomes: what to connect, and the chip
/// that opens the settings page to do it.
///
/// The chip targets the Harness settings page rather than Integrations, and
/// names the harness by slug — the frontend reads the reader's own Cursor
/// key status off that, so once they have connected, the same message reads
/// as connected instead of nagging them again.
fn decline_markdown(blocker: SessionBlocker) -> String {
    match blocker {
        SessionBlocker::CursorNotConnected => {
            let chip = serde_json::json!({
                "appSlug": "cursor",
                "name": "Cursor",
                "target": "harness",
            });
            format!(
                "`@cursor` runs on your own Cursor account, and yours is not connected yet. \
                 Add your Cursor API key, then mention me again. \
                 <{tag}>{chip}</{tag}>",
                tag = CONNECT_APP_TAG,
            )
        }
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
        self.messages
            .post(
                access,
                PostMessage {
                    attribution: MessageAttribution::ActingUser,
                    anchor: None,
                    content: decline_markdown(declined.blocker),
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
