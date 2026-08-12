#![deny(missing_docs)]

//! Channel bots: trigger built-in bot behavior from channel events.
//!
//! Channels emit a [`ChannelBotTrigger`](channels::domain::side_effects::ChannelBotTrigger)
//! candidate for every user-authored message. The inbound
//! [`BotTriggerRouter`](inbound::BotTriggerRouter) resolves each candidate
//! through a [`TriggerDetector`](domain::ports::TriggerDetector) — an explicit
//! `@`-mention triggers the mentioned bots, and a thread reply with no mention
//! may trigger an *inferred* Macro AI invocation when the thread already
//! contains an agent message and a fast-model classifier judges that the
//! message expects an agent response — and runs the appropriate domain
//! service:
//!
//! * **System bots** (defined inside Macro) run in-process. The only one today
//!   is Macro AI, handled by
//!   [`MacroAiHandler`](domain::service::MacroAiHandler), which posts an
//!   immediate "thinking" message, runs the agent loop, then edits the message
//!   with the answer.

/// Domain layer: bot trigger models, ports, and service implementation.
pub mod domain;
/// Inbound adapters for channel bot triggers.
pub mod inbound;
/// Outbound adapters for channel bot dependencies.
pub mod outbound;
