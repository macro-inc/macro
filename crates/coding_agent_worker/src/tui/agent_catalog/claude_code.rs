use super::npm_adapter::NpmAdapter;
use super::{AgentKind, AgentPreset, Availability, CommandLookup};
use crate::config::Harness;

const ADAPTER: NpmAdapter = NpmAdapter {
    package: "@agentclientprotocol/claude-agent-acp@0.73.0",
    bin: "claude-agent-acp",
    cli: "claude",
    cli_path_env: "CLAUDE_CODE_EXECUTABLE",
};

pub(super) struct ClaudeCode;

impl AgentPreset for ClaudeCode {
    fn kind(&self) -> AgentKind {
        AgentKind::ClaudeCode
    }

    fn name(&self) -> &'static str {
        "Claude Code"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        ADAPTER.detect(self, commands)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        ADAPTER.recognizes(harness)
    }
}
