//! Delegating repository work to the user's available coding personas.

use crate::types::StaticPrompt;

/// Selection and handoff guidance, included only where the tools are available.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Coding agents",
    include_str!("coding_agents.txt"),
    "Select an available coding persona and start a session for repository work. Pull-request tasks require a ready, CI-passing pull request rather than a draft.",
);

/// Code-mode replacement for [`PROMPT`]: these sessions start agents through
/// the SDK, and the dispatch tools are hidden there.
pub static CODE_MODE_PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Starting agent sessions",
    include_str!("code_mode_agents.txt"),
    "Work natively first; start another agent's session from ExecuteCode with macro.agents.list and macro.agentSessions.createManaged. Pull-request tasks require a ready, CI-passing pull request rather than a draft.",
);
