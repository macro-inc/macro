//! Announce sessions by posting into the mention's thread as the bot.
//!
//! Implements [`SessionAnnouncer`] over the channels domain's own
//! [`ChannelService`] port, so the post gets the full side-effect fan-out -
//! persistence, realtime, notifications, broker - exactly as if it came
//! through the channel API. The composition root decides which
//! `ChannelService` implementation (and side-effect stack) this wraps.
//!
//! The announcement links the session's dedicated channel with an inline
//! channel mention.

use std::sync::Arc;

use bot_id::BotId;
use channel_sender::ChannelSender;
use channels::domain::models::{PostMessageNotificationPolicy, PostMessageRequest};
use channels::domain::ports::ChannelService;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SessionAnnouncement;
use crate::domain::ports::SessionAnnouncer;

fn template_new_agent_session_response(session_channel_id: macro_uuid::Uuid) -> String {
    format!("Agent session created! Channel: [[channel-mention;{session_channel_id}]]")
}

/// Posts session announcements as `bot_id` through a [`ChannelService`].
pub struct ChannelAnnouncer<Channels> {
    channels: Arc<Channels>,
    bot_id: BotId,
}

impl<Channels> ChannelAnnouncer<Channels> {
    /// Announce as `bot_id`, posting through `channels`.
    pub fn new(channels: Arc<Channels>, bot_id: BotId) -> Self {
        Self { channels, bot_id }
    }
}

impl<Channels> SessionAnnouncer for ChannelAnnouncer<Channels>
where
    Channels: ChannelService + Send + Sync + 'static,
{
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<()> {
        let content = template_new_agent_session_response(announcement.session_channel_id);

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
