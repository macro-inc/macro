//! Channel adapter: post the harness's messages as the bot.
//!
//! Calls `channels`' own [`ChannelService`] in process. There is no HTTP here
//! and no bot token: authenticating to our own API to reach a service we already
//! link would only re-derive, over a socket, an actor we can pass as an
//! argument.
//!
//! The actor is a bot [`Sender`], so the message is *authored* by the harness
//! bot - the same thing `post_message_handler` does after resolving a bot
//! principal from its receipt. `triggered_by` separately records which user
//! caused the post, which is what lets a reader tell whose request an agent is
//! answering.
//!
//! Generic over the service so the composition root decides how much of the
//! side-effect machinery is wired. That matters: `ChannelServiceImpl::new` uses
//! a no-op event dispatcher, which persists the message but emits no broker
//! event and pushes nothing to connected clients - so it would not appear until
//! a refresh. `with_dependencies` is what makes it show up live.
//!
//! The bot must also be a *participant* of the channel to clear the
//! member-role check. Nothing here adds it.
//!
//! Which thread to post into is the caller's decision - see [`ChannelReplier`]
//! for why a run writes to two of them.

use anyhow::Context;
use bot_id::BotId;
use channels::domain::models::{PostMessageRequest, Sender};
use channels::domain::ports::ChannelService;
use channels::domain::side_effects::ChannelBotTrigger;
use macro_uuid::{Uuid, string_to_uuid};
use std::sync::Arc;

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
        %thread_id,
    ))]
    async fn post(
        &self,
        trigger: &ChannelBotTrigger,
        thread_id: Uuid,
        body: String,
    ) -> anyhow::Result<Uuid> {
        let response = self
            .channels
            .post_message(
                Sender::new_from_bot(self.bot),
                trigger.channel_id,
                PostMessageRequest {
                    content: body,
                    mentions: Vec::new(),
                    thread_id: Some(thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    notification_policy:
                        channels::domain::models::PostMessageNotificationPolicy::default(),
                    // Provenance, not authorship: the sender is the bot, and
                    // this records which user caused it to speak. `None` when a
                    // bot triggered us, since the column is for user-triggered
                    // agent posts.
                    triggered_by: trigger.message.sender_id.as_user().map(ToString::to_string),
                },
            )
            .await
            .context("posting a channel reply")?;

        string_to_uuid(&response.id).context("channels returned a non-uuid message id")
    }
}
