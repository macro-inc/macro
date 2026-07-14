//! Model availability for chat, gated by the user's plan.
//!
//! Free (non-professional) users may use only [`FREE_MODEL`]; professional
//! users may use every model in [`CHAT_MODELS`].

/// The chat models offered to users, best-first.
pub const CHAT_MODELS: &[&str] = &[
    "anthropic/claude-opus-4-8",
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-opus-4-7",
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-5.5",
    "openai/gpt-5-mini",
];

/// The only model available to free (non-professional) users.
pub const FREE_MODEL: &str = "anthropic/claude-haiku-4-5";
