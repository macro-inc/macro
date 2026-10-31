//! Routes committed posts to the built-in bot handlers.

use std::sync::Arc;

use messages::domain::{api::MessageServiceApi, events::MessagePostedMetadata};
use tokio::sync::mpsc::UnboundedReceiver;
use tracing::Instrument as _;

use crate::domain::{
    models::BotEvent,
    ports::{AgentResponder, CommentMarks, ConversationAccess, TriggerDetector, UserTimeZones},
    service::MacroAiHandler,
};

/// Resolves the bot invocations for a committed post and runs their handlers.
///
/// Receives every human-authored post the shared message service commits, on
/// a channel or a document. A [`TriggerDetector`] decides which bots each
/// candidate invokes — explicit `@`-mentions or an inferred invocation.
/// Dispatch is fire-and-forget: each candidate is handled on a spawned task.
///
/// System bots are defined in code and require no database row. Unknown bot ids
/// are ignored here; only Macro AI is handled by this branch. Non-system bots
/// are notified of mentions out of process via the trigger topic and webhooks
/// instead (see the `agent_trigger` and `webhook` crates).
pub struct BotTriggerRouter<R, D, Z> {
    macro_ai: Arc<MacroAiHandler<R, Z>>,
    detector: Arc<D>,
}

impl<R, D, Z> Clone for BotTriggerRouter<R, D, Z> {
    fn clone(&self) -> Self {
        Self {
            macro_ai: self.macro_ai.clone(),
            detector: self.detector.clone(),
        }
    }
}

impl<R, D, Z> BotTriggerRouter<R, D, Z>
where
    R: AgentResponder,
    D: TriggerDetector,
    Z: UserTimeZones,
{
    /// Create a router with the built-in system bots registered.
    pub fn new(
        messages: Arc<dyn MessageServiceApi>,
        access: Arc<dyn ConversationAccess>,
        responder: Arc<R>,
        detector: Arc<D>,
        time_zones: Arc<Z>,
        marks: Arc<dyn CommentMarks>,
    ) -> Self {
        Self::new_with_admission(
            messages,
            access,
            responder,
            detector,
            time_zones,
            marks,
            Arc::new(ai_billing::DisabledAiAdmissionService),
        )
    }

    /// Create a router with configured response admission. The detector must
    /// independently admit any inference it performs.
    pub fn new_with_admission(
        messages: Arc<dyn MessageServiceApi>,
        access: Arc<dyn ConversationAccess>,
        responder: Arc<R>,
        detector: Arc<D>,
        time_zones: Arc<Z>,
        marks: Arc<dyn CommentMarks>,
        admission: Arc<dyn ai_billing::AiAdmissionService>,
    ) -> Self {
        Self {
            macro_ai: Arc::new(
                MacroAiHandler::new(messages, access, responder, time_zones, marks)
                    .with_admission(admission),
            ),
            detector,
        }
    }

    /// Start consuming bot trigger candidates.
    pub fn spawn(self, mut candidates: UnboundedReceiver<MessagePostedMetadata>)
    where
        R: 'static,
        D: 'static,
        Z: 'static,
    {
        tokio::spawn(async move {
            while let Some(candidate) = candidates.recv().await {
                let router = self.clone();
                let span = tracing::info_span!(
                    "message.bot_trigger",
                    parent = ?candidate.parent,
                    message.id = %candidate.message_id,
                );
                tokio::spawn(async move {
                    router.run(candidate).instrument(span).await;
                });
            }
        });
    }

    async fn run(&self, candidate: MessagePostedMetadata) {
        // Attribution names the user whose access and billing apply.
        let Some(requesting_user) = candidate.invoking_user() else {
            return;
        };
        let reply_thread_id = candidate.root_id();

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
