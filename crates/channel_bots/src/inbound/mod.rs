//! Inbound adapters for channel bot triggers.

mod bot_trigger_router;

pub use bot_trigger_router::{
    BotTriggerQueueReceiver, BotTriggerQueueSender, BotTriggerRouter, bot_trigger_queue,
};
