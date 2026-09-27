use super::{AgentKind, AgentPreset, Availability, CommandLookup, DetectedAgent, LaunchSpec};
use crate::config::Harness;

/// Claude Code's own TUI, one herdr tab per session, driven over ACP by
/// `macrod herdr-acp`. Offered only when macrod itself runs inside herdr.
pub(super) struct HerdrClaude;

impl AgentPreset for HerdrClaude {
    fn kind(&self) -> AgentKind {
        AgentKind::HerdrClaude
    }

    fn name(&self) -> &'static str {
        "Claude Code in herdr"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        let missing: Vec<&'static str> = ["claude", "herdr"]
            .into_iter()
            .filter(|command| commands.resolve(command).is_none())
            .collect();
        if !missing.is_empty() {
            return Availability::Unavailable { missing };
        }
        if crate::herdr::HerdrSession::detect().is_none() {
            return Availability::Unavailable {
                missing: vec!["a herdr pane"],
            };
        }
        let Ok(exe) = std::env::current_exe() else {
            return Availability::Unavailable {
                missing: vec!["macrod"],
            };
        };
        Availability::Available(DetectedAgent {
            kind: self.kind(),
            name: self.name(),
            launch: LaunchSpec {
                command: exe.to_string_lossy().into_owned(),
                args: vec![
                    crate::herdr::acp_agent::SUBCOMMAND.to_owned(),
                    "--permission-mode".to_owned(),
                    "acceptEdits".to_owned(),
                ],
                env: std::collections::BTreeMap::new(),
            },
            note: Some("a live Claude Code tab per session"),
            install: None,
        })
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        crate::herdr::drives_herdr(harness)
    }
}
