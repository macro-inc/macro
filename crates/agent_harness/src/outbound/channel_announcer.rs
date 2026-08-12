//! Announce sessions by posting into the mention's thread as the bot.
//!
//! Implements [`SessionAnnouncer`] over the channels domain's own
//! [`ChannelService`] port, so the post gets the full side-effect fan-out -
//! persistence, realtime, notifications, broker - exactly as if it came
//! through the channel API. The composition root decides which
//! `ChannelService` implementation (and side-effect stack) this wraps.
//!
//! The announcement quotes the prompting message above the session's magic
//! chip. The content is composed by the lexical service — the one place that
//! builds message markdown from real Lexical nodes — so this adapter never
//! formats markdown itself.

#[cfg(test)]
mod test;

use std::sync::Arc;

use bot_id::BotId;
use channel_sender::ChannelSender;
use channels::domain::models::{PostMessageNotificationPolicy, PostMessageRequest};
use channels::domain::ports::ChannelService;
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::AgentAnnouncementChip;

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

/// Posts session announcements as `bot_id` through a [`ChannelService`].
pub struct ChannelAnnouncer<Channels> {
    channels: Arc<Channels>,
    bot_id: BotId,
    lexical: LexicalClient,
}

impl<Channels> ChannelAnnouncer<Channels> {
    /// Announce as `bot_id`, posting through `channels`, with content
    /// composed by `lexical`.
    pub fn new(channels: Arc<Channels>, bot_id: BotId, lexical: LexicalClient) -> Self {
        Self {
            channels,
            bot_id,
            lexical,
        }
    }
}

impl<Channels> SessionAnnouncer for ChannelAnnouncer<Channels>
where
    Channels: ChannelService + Send + Sync + 'static,
{
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<()> {
        let chip = announcement_chip(&announcement);
        let content = self
            .lexical
            .compose_agent_announcement(&announcement.prompted_content, &chip)
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        self.channels
            .post_message(
                ChannelSender::new_from_bot(self.bot_id),
                announcement.origin_channel_id,
                PostMessageRequest {
                    content,
                    mentions: Vec::new(),
                    thread_id: Some(announcement.origin_thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    notification_policy: PostMessageNotificationPolicy::default(),
                    // Attributed to whoever mentioned the bot, so the reply
                    // reads as their agent answering.
                    triggered_by: Some(announcement.triggered_by.as_ref().to_owned()),
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        Ok(())
    }
}
