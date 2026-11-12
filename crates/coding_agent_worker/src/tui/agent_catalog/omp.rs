use super::{AgentKind, AgentPreset, Availability, CommandLookup, direct, is_launch};
use crate::config::Harness;

pub(super) struct Omp;

impl AgentPreset for Omp {
    fn kind(&self) -> AgentKind {
        AgentKind::Omp
    }

    fn name(&self) -> &'static str {
        "OMP"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        direct(self, commands, "omp", ["acp"])
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "omp", &["acp"])
    }
}
