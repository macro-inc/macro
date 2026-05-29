//! Routes channel bot triggers to the appropriate handler.

use std::collections::HashMap;
use std::sync::Arc;

use bot_id::BotId;
use channels::domain::ports::ChannelBotDispatcher;
use channels::domain::side_effects::ChannelBotTrigger;

use crate::directory::BotDirectory;
use crate::handlers::{
    BotEvent, BotHandler, BotTrigger, MacroAiHandler, SystemBotHandler, WebhookBotHandler,
};
use crate::poster::ChannelBotPoster;
use crate::responder::AgentResponder;

/// Resolves the bots mentioned in a channel message and runs their handlers.
///
/// Wired into the channels side-effect service as a [`ChannelBotDispatcher`].
/// Dispatch is fire-and-forget: each trigger is handled on a spawned task.
///
/// System bots are defined in code (a registry keyed by [`BotId`]) and require
/// no database row. Any other mentioned bot is treated as an external bot and
/// looked up in the database; if it has a webhook the trigger is delivered there.
#[derive(Clone)]
pub struct BotTriggerRouter {
    system_bots: Arc<HashMap<BotId, Arc<dyn SystemBotHandler>>>,
    directory: Arc<dyn BotDirectory>,
    webhook: Arc<WebhookBotHandler>,
}

impl BotTriggerRouter {
    /// Create a router with the built-in system bots registered.
    pub fn new(
        directory: Arc<dyn BotDirectory>,
        poster: Arc<dyn ChannelBotPoster>,
        responder: Arc<dyn AgentResponder>,
    ) -> Self {
        let mut system_bots: HashMap<BotId, Arc<dyn SystemBotHandler>> = HashMap::new();
        // Macro Agent: the built-in, code-defined system bot.
        system_bots.insert(
            bot_id::MACRO_AI_BOT_ID,
            Arc::new(MacroAiHandler::new(poster, responder)),
        );

        Self {
            system_bots: Arc::new(system_bots),
            directory,
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
            let event = BotEvent {
                trigger: BotTrigger::Mention,
                channel_id: trigger.channel_id,
                message: trigger.message.clone(),
                reply_thread_id,
                requesting_user: requesting_user.clone(),
            };

            // System bots are defined in code — no database lookup required.
            if let Some(handler) = self.system_bots.get(id) {
                if let Err(err) = handler.handle(&event).await {
                    tracing::error!(error=?err, bot_id = %id, "system bot handler failed");
                }
                continue;
            }

            // Otherwise it's an external bot: look it up and deliver to its webhook.
            let bot = match self.directory.get_bot(*id).await {
                Ok(Some(bot)) => bot,
                Ok(None) => continue,
                Err(err) => {
                    tracing::error!(error=?err, bot_id = %id, "failed to look up bot for trigger");
                    continue;
                }
            };
            if bot.webhook_url.is_some() {
                if let Err(err) = self.webhook.handle(&bot, &event).await {
                    tracing::error!(error=?err, bot_id = %bot.id, "bot webhook handler failed");
                }
            } else {
                tracing::debug!(bot_id = %bot.id, "no handler registered for bot trigger");
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
