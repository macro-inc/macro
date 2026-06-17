//! Static prompt fragments used to compose AI system prompts.
//!
//! Each module holds one prompt section as static strings and exports a
//! `PROMPT` static — a [`StaticPrompt`] borrowing string data with `'static`
//! lifetime. Prompts chain together via [`StaticPrompt::compose`].
#![deny(missing_docs)]

pub mod about_macro;
pub mod channel_mention;
pub mod citations;
pub mod do_not;
pub mod math;
pub mod mentions;
pub mod tone;
pub mod tool_usage;
mod types;

pub use types::{ComposedPrompt, Section, StaticPrompt};

/// The base prompt: tone, math, citations, mentions, do-not rules, and Macro
/// terms. Contains no tool use instructions.
pub static BASE_PROMPT: ComposedPrompt = tone::PROMPT
    .compose(&math::PROMPT)
    .compose(&citations::PROMPT)
    .compose(&mentions::PROMPT)
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT);

/// The tool-enabled prompt: [`BASE_PROMPT`] with the tool use instructions
/// appended.
pub static TOOL_USE_PROMPT: ComposedPrompt = BASE_PROMPT.compose(&tool_usage::PROMPT);

/// Instructions surfaced to external MCP clients via the server `instructions`
/// field. Carries the formatting/correctness rules Macro features depend on —
/// mentions, citations, do-not rules, and Macro terms — so that AI used through
/// MCP produces valid Macro mentions and citations. Deliberately omits chat
/// tone/style and tool-use instructions, which belong to the host client, not
/// to Macro.
pub static MCP_INSTRUCTIONS: ComposedPrompt = mentions::PROMPT
    .compose(&citations::PROMPT)
    .compose(&do_not::PROMPT)
    .compose(&about_macro::PROMPT);
