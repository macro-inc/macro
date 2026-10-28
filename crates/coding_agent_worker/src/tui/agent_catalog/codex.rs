use super::npm_adapter::NpmAdapter;
use super::{AgentKind, AgentPreset, Availability, CommandLookup};
use crate::config::Harness;

const ADAPTER: NpmAdapter = NpmAdapter {
    package: "@agentclientprotocol/codex-acp@1.8.0",
    bin: "codex-acp",
    cli: "codex",
    cli_path_env: "CODEX_PATH",
};

pub(super) struct Codex;

impl AgentPreset for Codex {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
    }

    fn name(&self) -> &'static str {
        "Codex CLI"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        ADAPTER.detect(self, commands)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        ADAPTER.recognizes(harness)
    }
}
