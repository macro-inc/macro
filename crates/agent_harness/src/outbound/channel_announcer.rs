//! Announce agent responses in their originating message thread through the shared service.

#[cfg(test)]
mod test;

use std::sync::Arc;

use entity_access::domain::{
    models::{BotAccessScope, EntityType},
    ports::EntityAccessService,
};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{AgentAnnouncementChip, AgentAnnouncementReplyTarget};
use messages::domain::{
    api::MessageCommands,
    models::{MessageParent, PostMessage},
    service::MessageWrite,
};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SessionAnnouncement;
use crate::domain::ports::SessionAnnouncer;

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
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<()> {
        let access = self
            .access
            .generate_bot_entity_access_receipt::<MessageWrite>(
                announcement.bot_id,
                BotAccessScope::user(announcement.triggered_by.clone()),
                &announcement.origin_parent.entity_id(),
                match announcement.origin_parent {
                    MessageParent::Channel(_) => EntityType::Channel,
                    MessageParent::Document(_) => EntityType::Document,
                },
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
        self.messages
            .post(
                access,
                PostMessage {
                    attribution: Default::default(),
                    notification_policy: Default::default(),
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
        Ok(())
    }
}
