//! Channel adapter: post the harness's replies as the bot.
//!
//! Calls `channels`' own [`ChannelService`] in process. There is no HTTP here
//! and no bot token: authenticating to our own API to reach a service we already
//! link would only re-derive, over a socket, an actor we can just pass as an
//! argument.
//!
//! The actor is a bot [`Sender`], so the message is attributed to the harness
//! bot rather than to whoever mentioned it - the same thing
//! `post_message_handler` does after resolving a bot principal from its receipt.
//!
//! Generic over the service so the composition root decides how much of the
//! side-effect machinery is wired. That matters: `ChannelServiceImpl::new` uses
//! a no-op event dispatcher, which persists the message but emits no broker
//! event and pushes nothing to connected clients - so the reply would not appear
//! until a refresh. `with_dependencies` is what makes it show up live.

use anyhow::Context;
use bot_id::BotId;
use channels::domain::models::{PostMessageRequest, Sender};
use channels::domain::ports::ChannelService;
use channels::domain::side_effects::ChannelBotTrigger;
use macro_uuid::{Uuid, string_to_uuid};
use std::sync::Arc;

use crate::domain::models::reply_thread_id;
use crate::domain::ports::ChannelReplier;

/// Posts harness replies through the channels service.
pub struct ChannelsReplier<Channels> {
    channels: Arc<Channels>,
    bot: BotId,
}

impl<Channels> ChannelsReplier<Channels> {
    /// Post as `bot` through `channels`.
    #[must_use]
    pub fn new(channels: Arc<Channels>, bot: BotId) -> Self {
        Self { channels, bot }
    }
}

impl<Channels: ChannelService> ChannelReplier for ChannelsReplier<Channels> {
    #[tracing::instrument(err, skip(self, trigger, body), fields(
        channel_id = %trigger.channel_id,
        thread_id = %reply_thread_id(trigger),
    ))]
    async fn reply(&self, trigger: &ChannelBotTrigger, body: String) -> anyhow::Result<Uuid> {
        let response = self
            .channels
            .post_message(
                Sender::new_from_bot(self.bot),
                trigger.channel_id,
                PostMessageRequest {
                    content: body,
                    mentions: Vec::new(),
                    // Always a thread: a top-level mention gets a new thread
                    // hanging off the mention itself.
                    thread_id: Some(reply_thread_id(trigger)),
                    attachments: Vec::new(),
                    nonce: None,
                    notification_policy:
                        channels::domain::models::PostMessageNotificationPolicy::default(),
                    // Attributes the post to the person who asked, which is what
                    // makes it read as their agent answering rather than a bot
                    // talking to itself.
                    triggered_by: trigger.message.sender_id.as_user().map(ToString::to_string),
                },
            )
            .await
            .context("posting a channel reply")?;

        string_to_uuid(&response.id).context("channels returned a non-uuid message id")
    }
}
