use super::{AgentKind, AgentPreset, Availability, CommandLookup, direct, is_launch};
use crate::config::Harness;

pub(super) struct Hermes;

impl AgentPreset for Hermes {
    fn kind(&self) -> AgentKind {
        AgentKind::Hermes
    }

    fn name(&self) -> &'static str {
        "Hermes Agent"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        if commands.resolve("hermes").is_some() {
            direct(self, commands, "hermes", ["acp"])
        } else {
            direct(self, commands, "hermes-acp", [])
        }
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "hermes", &["acp"]) || is_launch(harness, "hermes-acp", &[])
    }
}
