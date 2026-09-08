use super::{AgentKind, AgentPreset, Availability, CommandLookup, direct, is_launch};
use crate::config::Harness;

pub(super) struct OpenCode;

impl AgentPreset for OpenCode {
    fn kind(&self) -> AgentKind {
        AgentKind::OpenCode
    }

    fn name(&self) -> &'static str {
        "OpenCode"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        direct(self, commands, "opencode", ["acp"])
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "opencode", &["acp"])
    }
}
