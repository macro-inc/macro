//! Routes channel bot triggers to the appropriate handler.

use std::sync::Arc;

use channels::domain::ports::ChannelBotDispatcher;
use channels::domain::side_effects::ChannelBotTrigger;

use crate::directory::BotDirectory;
use crate::handlers::{BotEvent, BotHandler, BotTrigger, MacroAiHandler, WebhookBotHandler};
use crate::poster::ChannelBotPoster;
use crate::responder::AgentResponder;

/// Resolves the bots mentioned in a channel message and runs their handlers.
///
/// Wired into the channels side-effect service as a
/// [`ChannelBotDispatcher`]. Dispatch is fire-and-forget: each trigger is
/// handled on a spawned task.
#[derive(Clone)]
pub struct BotTriggerRouter {
    directory: Arc<dyn BotDirectory>,
    macro_ai: Arc<MacroAiHandler>,
    webhook: Arc<WebhookBotHandler>,
}

impl BotTriggerRouter {
    /// Create a router.
    pub fn new(
        directory: Arc<dyn BotDirectory>,
        poster: Arc<dyn ChannelBotPoster>,
        responder: Arc<dyn AgentResponder>,
    ) -> Self {
        Self {
            directory,
            macro_ai: Arc::new(MacroAiHandler::new(poster, responder)),
            webhook: Arc::new(WebhookBotHandler::new(reqwest::Client::new())),
        }
    }

    async fn run(&self, trigger: ChannelBotTrigger) {
        // Guarded upstream, but double-check: only user messages trigger bots.
        let Some(requesting_user) = trigger.message.sender_id.as_user().cloned() else {
            return;
        };
        let reply_thread_id = trigger.message.thread_id.unwrap_or(trigger.message.id);

        for id in &trigger.bot_ids {
            let bot = match self.directory.get_bot(*id).await {
                Ok(Some(bot)) => bot,
                Ok(None) => continue,
                Err(err) => {
                    tracing::error!(error=?err, bot_id = %id, "failed to look up bot for trigger");
                    continue;
                }
            };

            let event = BotEvent {
                trigger: BotTrigger::Mention,
                channel_id: trigger.channel_id,
                message: trigger.message.clone(),
                reply_thread_id,
                requesting_user: requesting_user.clone(),
            };

            let handler: &dyn BotHandler = if bot.id == bot_id::MACRO_AI_BOT_ID {
                self.macro_ai.as_ref()
            } else if bot.webhook_url.is_some() {
                self.webhook.as_ref()
            } else {
                tracing::debug!(bot_id = %bot.id, "no handler registered for bot trigger");
                continue;
            };

            if let Err(err) = handler.handle(&bot, &event).await {
                tracing::error!(error=?err, bot_id = %bot.id, "bot handler failed");
            }
        }
    }
}

impl ChannelBotDispatcher for BotTriggerRouter {
    fn dispatch(&self, trigger: ChannelBotTrigger) {
        let router = self.clone();
        tokio::spawn(async move {
            router.run(trigger).await;
        });
    }
}
