use super::{AgentKind, AgentPreset, Availability, CommandLookup, direct, is_launch};
use crate::config::Harness;

pub(super) struct OpenClaw;

impl AgentPreset for OpenClaw {
    fn kind(&self) -> AgentKind {
        AgentKind::OpenClaw
    }

    fn name(&self) -> &'static str {
        "OpenClaw"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        direct(self, commands, "openclaw", ["acp"])
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "openclaw", &["acp"])
    }
}
