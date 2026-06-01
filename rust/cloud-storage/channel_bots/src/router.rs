//! Routes channel bot triggers to the appropriate handler.

use std::collections::HashMap;
use std::sync::Arc;

use bot_id::BotId;
use channels::domain::ports::ChannelBotDispatcher;
use channels::domain::side_effects::ChannelBotTrigger;

use crate::handlers::{BotEvent, BotTrigger, MacroAiHandler, SystemBotHandler};
use crate::poster::ChannelBotPoster;
use crate::responder::AgentResponder;

/// Resolves the bots mentioned in a channel message and runs their handlers.
///
/// Wired into the channels side-effect service as a [`ChannelBotDispatcher`].
/// Dispatch is fire-and-forget: each trigger is handled on a spawned task.
///
/// System bots are defined in code (a registry keyed by [`BotId`]) and require
/// no database row. Unknown bot ids are ignored for now; only system bots are
/// handled by this branch.
#[derive(Clone)]
pub struct BotTriggerRouter {
    system_bots: Arc<HashMap<BotId, Arc<dyn SystemBotHandler>>>,
}

impl BotTriggerRouter {
    /// Create a router with the built-in system bots registered.
    pub fn new(poster: Arc<dyn ChannelBotPoster>, responder: Arc<dyn AgentResponder>) -> Self {
        let mut system_bots: HashMap<BotId, Arc<dyn SystemBotHandler>> = HashMap::new();
        // Macro Agent: the built-in, code-defined system bot.
        system_bots.insert(
            bot_id::MACRO_AI_BOT_ID,
            Arc::new(MacroAiHandler::new(poster, responder)),
        );

        Self {
            system_bots: Arc::new(system_bots),
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
            } else {
                tracing::debug!(bot_id = %id, "no system bot handler registered for bot trigger");
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
