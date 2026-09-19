use super::{AgentKind, AgentPreset, Availability, CommandLookup, is_launch, npm_adapter};
use crate::config::Harness;

const ADAPTER: &str = "@agentclientprotocol/claude-agent-acp@0.73.0";

pub(super) struct ClaudeCode;

impl AgentPreset for ClaudeCode {
    fn kind(&self) -> AgentKind {
        AgentKind::ClaudeCode
    }

    fn name(&self) -> &'static str {
        "Claude Code"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        npm_adapter(self, commands, "claude", ADAPTER)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "npx", &["-y", ADAPTER])
    }
}
