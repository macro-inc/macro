//! Delegating repository work to the user's available coding personas.

use crate::types::StaticPrompt;

/// Selection and handoff guidance, included only where the tools are available.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Coding agents",
    include_str!("coding_agents.txt"),
    "Select an available coding persona and start a session for repository work.",
);
