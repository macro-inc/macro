//! Model availability for chat, gated by the user's plan.
//!
//! Free (non-professional) users may use only [`FREE_MODEL`]; professional
//! users may use every model in [`CHAT_MODELS`].

/// The chat models offered to users, best-first.
///
/// The current Anthropic generation is Sonnet 5.5 and Opus 5.5. Haiku 4.5
/// stays as the fast model; older Sonnet, Opus, and Fable ids are absent.
pub const CHAT_MODELS: &[&str] = &[
    "anthropic/claude-sonnet-5-5",
    "anthropic/claude-opus-5-5",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-6-astra",
    "openai/gpt-5.6",
    "openai/gpt-5.6-mini",
    "openai/gpt-5.5",
    "openai/gpt-5-mini",
];

/// The default model for professional (paid) users.
pub const PAID_DEFAULT_MODEL: &str = "anthropic/claude-sonnet-5-5";

/// The only model available to free (non-professional) users.
pub const FREE_MODEL: &str = "anthropic/claude-haiku-4-5";
