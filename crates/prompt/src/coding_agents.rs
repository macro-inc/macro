//! Starting another agent's session from code mode.

use crate::types::StaticPrompt;

/// Persona selection and handoff guidance, included only where ExecuteCode is available.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(
    "Starting agent sessions",
    include_str!("coding_agents.txt"),
    "Work natively first; start another agent's session from ExecuteCode with macro.agents.list and macro.agentSessions.createManaged. Pull-request tasks require a ready, CI-passing pull request rather than a draft.",
);
