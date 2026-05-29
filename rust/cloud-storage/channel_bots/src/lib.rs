#![deny(missing_docs)]

//! Channel bots: a generic framework for triggering bot behavior from channel
//! events, plus the built-in Macro AI handler.
//!
//! Channels emit [`ChannelBotTrigger`](channels::domain::side_effects::ChannelBotTrigger)s
//! when a user message mentions one or more bots. The [`BotTriggerRouter`]
//! resolves each mentioned bot and runs the appropriate [`BotHandler`]:
//!
//! * **System bots** (defined inside Macro) run in-process. The only one today
//!   is Macro AI, handled by [`MacroAiHandler`], which posts an immediate
//!   "thinking" message, runs the agent loop, then edits the message with the
//!   answer.
//! * **External bots** (e.g. Linear, Datadog) declare a `webhook_url`; the
//!   [`WebhookBotHandler`] delivers the trigger there.

mod directory;
mod handlers;
mod poster;
mod responder;
mod router;

pub use directory::BotDirectory;
pub use handlers::{
    BotEvent, BotHandler, BotTrigger, MacroAiHandler, SystemBotHandler, WebhookBotHandler,
};
pub use poster::ChannelBotPoster;
pub use responder::{AgentResponder, DcsAgentResponder};
pub use router::BotTriggerRouter;
