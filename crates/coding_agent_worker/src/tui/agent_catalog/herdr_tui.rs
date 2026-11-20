use super::{AgentKind, AgentPreset, Availability, CommandLookup, DetectedAgent, LaunchSpec};
use crate::config::Harness;
use crate::herdr::acp_agent::TuiAgent;
use crate::herdr::{HcBinMissing, HerdrSession};

/// A coding agent's own TUI, one herdr tab per session, driven over ACP by
/// `macrod herdr-acp`. Offered only when macrod itself runs inside herdr.
pub(super) struct HerdrTui(pub(super) TuiAgent);

impl AgentPreset for HerdrTui {
    fn kind(&self) -> AgentKind {
        match self.0 {
            TuiAgent::Claude => AgentKind::HerdrClaude,
            TuiAgent::Codex => AgentKind::HerdrCodex,
        }
    }

    fn name(&self) -> &'static str {
        match self.0 {
            TuiAgent::Claude => "Claude Code in herdr",
            TuiAgent::Codex => "Codex in herdr",
        }
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        self.availability(HerdrSession::detect(), commands)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        crate::herdr::herdr_agent(harness) == Some(self.0)
    }
}

impl HerdrTui {
    /// Whether this agent can run in `herdr`, the herdr macrod was found in.
    pub(super) fn availability(
        &self,
        herdr: Result<Option<HerdrSession>, HcBinMissing>,
        commands: &dyn CommandLookup,
    ) -> Availability {
        let herdr = match herdr {
            Ok(Some(herdr)) => herdr,
            Ok(None) => {
                return Availability::Unavailable {
                    missing: vec!["a herdr pane"],
                };
            }
            Err(HcBinMissing) => {
                return Availability::Unavailable {
                    missing: vec!["HC_BIN"],
                };
            }
        };
        let missing: Vec<&'static str> = [Some(self.0.herdr_kind()), herdr.path_command()]
            .into_iter()
            .flatten()
            .filter(|command| commands.resolve(command).is_none())
            .collect();
        if !missing.is_empty() {
            return Availability::Unavailable { missing };
        }
        let Ok(exe) = std::env::current_exe() else {
            return Availability::Unavailable {
                missing: vec!["macrod"],
            };
        };
        let args = vec![
            crate::herdr::acp_agent::SUBCOMMAND.to_owned(),
            "--kind".to_owned(),
            self.0.herdr_kind().to_owned(),
        ];
        Availability::Available(DetectedAgent {
            kind: self.kind(),
            name: self.name(),
            launch: LaunchSpec {
                command: exe.to_string_lossy().into_owned(),
                args,
                env: std::collections::BTreeMap::new(),
            },
            note: None,
            install: None,
        })
    }
}
