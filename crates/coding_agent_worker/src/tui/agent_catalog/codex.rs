use super::{AgentKind, AgentPreset, Availability, CommandLookup, is_launch, npm_adapter};
use crate::config::Harness;

const ADAPTER: &str = "@agentclientprotocol/codex-acp@1.8.0";

pub(super) struct Codex;

impl AgentPreset for Codex {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
    }

    fn name(&self) -> &'static str {
        "Codex CLI"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        npm_adapter(self, commands, "codex", ADAPTER)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "npx", &["-y", ADAPTER])
    }
}
