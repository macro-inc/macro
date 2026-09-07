//! Routes channel bot triggers to the appropriate handler.

use std::sync::Arc;

use messages::domain::{api::MessageServiceApi, events::MessagePostedMetadata};
use tokio::sync::mpsc::UnboundedReceiver;
use tracing::Instrument as _;

use crate::domain::{
    models::BotEvent,
    ports::{AgentResponder, ConversationAccess, TriggerDetector},
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
pub struct BotTriggerRouter<R, D> {
    macro_ai: Arc<MacroAiHandler<R>>,
    detector: Arc<D>,
}

impl<R, D> Clone for BotTriggerRouter<R, D> {
    fn clone(&self) -> Self {
        Self {
            macro_ai: self.macro_ai.clone(),
            detector: self.detector.clone(),
        }
    }
}

impl<R, D> BotTriggerRouter<R, D>
where
    R: AgentResponder,
    D: TriggerDetector,
{
    /// Create a router with the built-in system bots registered.
    pub fn new(
        messages: Arc<dyn MessageServiceApi>,
        access: Arc<dyn ConversationAccess>,
        responder: Arc<R>,
        detector: Arc<D>,
    ) -> Self {
        Self {
            macro_ai: Arc::new(MacroAiHandler::new(messages, access, responder)),
            detector,
        }
    }

    /// Start consuming channel bot trigger candidates.
    pub fn spawn(self, mut candidates: UnboundedReceiver<MessagePostedMetadata>)
    where
        R: 'static,
        D: 'static,
    {
        tokio::spawn(async move {
            while let Some(candidate) = candidates.recv().await {
                let router = self.clone();
                let span = tracing::Span::current();
                tokio::spawn(async move {
                    router.run(candidate).instrument(span).await;
                });
            }
        });
    }

    async fn run(&self, candidate: MessagePostedMetadata) {
        // Guarded upstream, but double-check: only user messages trigger bots.
        let Some(requesting_user) = candidate.sender.as_user().cloned() else {
            return;
        };
        let reply_thread_id = candidate.thread_id.unwrap_or(candidate.message_id);

        for invocation in self.detector.detect(&candidate).await {
            let event = BotEvent {
                trigger: invocation.trigger,
                message: candidate.clone(),
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
