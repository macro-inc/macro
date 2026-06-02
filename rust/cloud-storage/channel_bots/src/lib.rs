#![deny(missing_docs)]

//! Channel bots: trigger built-in bot behavior from channel events.
//!
//! Channels emit [`ChannelBotTrigger`](channels::domain::side_effects::ChannelBotTrigger)s
//! when a user message mentions one or more bots. The [`BotTriggerRouter`]
//! resolves each mentioned system bot and runs the appropriate handler:
//!
//! * **System bots** (defined inside Macro) run in-process. The only one today
//!   is Macro AI, handled by [`MacroAiHandler`], which posts an immediate
//!   "thinking" message, runs the agent loop, then edits the message with the
//!   answer.

mod handlers;
mod responder;
mod router;

pub use handlers::{BotEvent, BotTrigger, MacroAiHandler};
pub use responder::{AgentResponder, DcsAgentResponder};
pub use router::BotTriggerRouter;
