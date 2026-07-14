//! Routes channel bot triggers to the appropriate handler.

use std::{future::Future, sync::Arc};

use channels::domain::ports::ChannelService;
use channels::domain::side_effects::ChannelBotTrigger;
use tokio::{
    sync::mpsc::UnboundedReceiver,
    task::{JoinHandle, JoinSet},
};

use crate::domain::{
    models::{BotEvent, BotTrigger},
    ports::AgentResponder,
    service::MacroAiHandler,
};

/// Resolves the bots mentioned in a channel message and runs their handlers.
///
/// Receives triggers derived by the channel side-effect service. Each trigger
/// runs concurrently in a child task owned by the router task.
///
/// System bots are defined in code and require no database row. Unknown bot ids
/// are ignored for now; only Macro AI is handled by this branch.
pub struct BotTriggerRouter<C, R> {
    macro_ai: Arc<MacroAiHandler<C, R>>,
}

impl<C, R> Clone for BotTriggerRouter<C, R> {
    fn clone(&self) -> Self {
        Self {
            macro_ai: self.macro_ai.clone(),
        }
    }
}

impl<C, R> BotTriggerRouter<C, R>
where
    C: ChannelService,
    R: AgentResponder,
{
    /// Create a router with the built-in system bots registered.
    pub fn new(channels: Arc<C>, responder: Arc<R>) -> Self {
        Self {
            macro_ai: Arc::new(MacroAiHandler::new(channels, responder)),
        }
    }

    /// Start consuming channel bot triggers.
    ///
    /// Aborting the returned task also aborts all bot executions it started.
    pub fn spawn(self, triggers: UnboundedReceiver<ChannelBotTrigger>) -> JoinHandle<()>
    where
        R: 'static,
    {
        spawn_router_task(triggers, move |trigger| {
            let router = self.clone();
            async move {
                router.run(trigger).await;
            }
        })
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
            if *id == bot_id::MACRO_AI_BOT_ID {
                if let Err(err) = self.macro_ai.handle(&event).await {
                    tracing::error!(error=?err, bot_id = %id, "system bot handler failed");
                }
            } else {
                tracing::debug!(bot_id = %id, "no system bot handler registered for bot trigger");
            }
        }
    }
}

fn spawn_router_task<F, Fut>(
    mut triggers: UnboundedReceiver<ChannelBotTrigger>,
    run: F,
) -> JoinHandle<()>
where
    F: Fn(ChannelBotTrigger) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        let mut executions = JoinSet::new();

        loop {
            tokio::select! {
                trigger = triggers.recv() => {
                    let Some(trigger) = trigger else {
                        break;
                    };
                    executions.spawn(run(trigger));
                }
                result = executions.join_next(), if !executions.is_empty() => {
                    if let Some(result) = result {
                        log_bot_execution_result(result);
                    }
                }
            }
        }

        while let Some(result) = executions.join_next().await {
            log_bot_execution_result(result);
        }
    })
}

fn log_bot_execution_result(result: Result<(), tokio::task::JoinError>) {
    if let Err(error) = result
        && error.is_panic()
    {
        tracing::error!(error=?error, "channel bot execution panicked");
    }
}

#[cfg(test)]
mod test;
