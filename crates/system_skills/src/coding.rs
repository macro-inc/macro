//! Agent-only skill: delegating repository work to the user's coding agents.

use crate::{SystemSkill, Visibility};

/// The coding skill.
pub static SKILL: SystemSkill = SystemSkill {
    slug: "coding",
    name: "Coding",
    description: "Use when work happens in a code repository: writing code, fixing a bug, investigating a codebase, or opening or changing a pull request; not changes to Macro databases, tables or documents.",
    visibility: Visibility::AgentOnly,
    tools: &["ListCodingAgents", "DispatchCodingAgent"],
    sdk_entities: &["agentSessions", "githubPullRequests"],
    instructions: include_str!("coding.md"),
};
