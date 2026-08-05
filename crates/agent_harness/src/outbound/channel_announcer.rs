//! Announce sessions by posting into the mention's thread as the bot.
//!
//! Implements [`SessionAnnouncer`] over the channels domain's own
//! [`ChannelService`] port, so the post gets the full side-effect fan-out -
//! persistence, realtime, notifications, broker - exactly as if it came
//! through the channel API. The composition root decides which
//! `ChannelService` implementation (and side-effect stack) this wraps.
//!
//! The announcement links the session's dedicated channel as a plain app URL:
//! the frontend has no inline channel-mention node yet (only user, group,
//! document, contact, and date), so a URL is what renders today. When a
//! channel chip exists, this is the one place that changes.

use std::sync::Arc;

use agent_session::domain::model::AgentSession;
use bot_id::BotId;
use channel_sender::ChannelSender;
use channels::domain::models::{PostMessageNotificationPolicy, PostMessageRequest};
use channels::domain::ports::ChannelService;

use crate::domain::service::{MentionOrigin, SessionAnnouncer};

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
    async fn announce(&self, session: &AgentSession, origin: &MentionOrigin) -> anyhow::Result<()> {
        let content = format!(
            "Agent session created! Channel: https://macro.com/app/channel/{}",
            session.channel_id
        );

        self.channels
            .post_message(
                ChannelSender::new_from_bot(self.bot_id),
                origin.channel_id,
                PostMessageRequest {
                    content,
                    mentions: Vec::new(),
                    thread_id: Some(origin.thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    notification_policy: PostMessageNotificationPolicy::default(),
                    // Attributed to whoever mentioned the bot, so the reply
                    // reads as their agent answering.
                    triggered_by: Some(origin.sender.as_ref().to_owned()),
                },
            )
            .await
            .map_err(|error| anyhow::anyhow!("failed to post the session announcement: {error}"))?;

        Ok(())
    }
}
