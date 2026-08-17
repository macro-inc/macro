//! Routes channel bot triggers to the appropriate handler.

use std::sync::Arc;

use channels::domain::ports::ChannelService;
use channels::domain::side_effects::ChannelBotTrigger;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::domain::{
    models::BotEvent,
    ports::{AgentResponder, TriggerDetector},
    service::MacroAiHandler,
};

/// Resolves the bot invocations for a candidate channel message and runs their
/// handlers.
///
/// Receives trigger candidates derived by the channel side-effect service. A
/// [`TriggerDetector`] decides which bots each candidate invokes — explicit
/// `@`-mentions or an inferred invocation. Dispatch is fire-and-forget: each
/// candidate is handled on a spawned task.
///
/// System bots are defined in code and require no database row. Unknown bot ids
/// are ignored here; only Macro AI is handled by this branch. Non-system bots
/// are notified of mentions out of process via the `channel.mentioned`
/// webhook event instead (see the `webhook` crate).
pub struct BotTriggerRouter<C, R, D> {
    macro_ai: Arc<MacroAiHandler<C, R>>,
    detector: Arc<D>,
}

impl<C, R, D> Clone for BotTriggerRouter<C, R, D> {
    fn clone(&self) -> Self {
        Self {
            macro_ai: self.macro_ai.clone(),
            detector: self.detector.clone(),
        }
    }
}

impl<C, R, D> BotTriggerRouter<C, R, D>
where
    C: ChannelService,
    R: AgentResponder,
    D: TriggerDetector,
{
    /// Create a router with the built-in system bots registered.
    pub fn new(channels: Arc<C>, responder: Arc<R>, detector: Arc<D>) -> Self {
        Self {
            macro_ai: Arc::new(MacroAiHandler::new(channels, responder)),
            detector,
        }
    }

    /// Start consuming channel bot trigger candidates.
    pub fn spawn(self, mut candidates: UnboundedReceiver<ChannelBotTrigger>)
    where
        R: 'static,
        D: 'static,
    {
        tokio::spawn(async move {
            while let Some(candidate) = candidates.recv().await {
                let router = self.clone();
                tokio::spawn(async move {
                    router.run(candidate).await;
                });
            }
        });
    }

    async fn run(&self, candidate: ChannelBotTrigger) {
        // Guarded upstream, but double-check: only user messages trigger bots.
        let Some(requesting_user) = candidate.message.sender_id.as_user().cloned() else {
            return;
        };
        let reply_thread_id = candidate.message.thread_id.unwrap_or(candidate.message.id);

        for invocation in self.detector.detect(&candidate).await {
            let event = BotEvent {
                trigger: invocation.trigger,
                channel_id: candidate.channel_id,
                message: candidate.message.clone(),
                reply_thread_id,
                requesting_user: requesting_user.clone(),
            };

            // System bots are defined in code — no database lookup required.
            if invocation.bot_id == bot_id::MACRO_AI_BOT_ID {
                if let Err(err) = self.macro_ai.handle(&event).await {
                    tracing::error!(error=?err, bot_id = %invocation.bot_id, "system bot handler failed");
                }
            } else {
                tracing::debug!(bot_id = %invocation.bot_id, "no system bot handler registered for bot trigger");
            }
        }
    }
}
