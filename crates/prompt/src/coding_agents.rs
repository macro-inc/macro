//! Starting named, coding, and in-memory agent sessions.

use crate::types::StaticPrompt;

/// Selection and handoff guidance, included only where the tools are available.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Agent sessions",
    include_str!("coding_agents.txt"),
    "Start a session with a named agent, integration, or model.",
);
