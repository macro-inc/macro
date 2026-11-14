//! Every real-machine source, configured from a few roots.

use std::path::PathBuf;
use std::time::Duration;

use crate::domain::source::{AgentSource, PrInterest};
use crate::outbound::claude_registry::ClaudeRegistrySource;
use crate::outbound::claude_transcripts::ClaudeTranscriptsSource;
use crate::outbound::codex_rollouts::CodexRolloutsSource;
use crate::outbound::github::{GhCli, GithubSource};
use crate::outbound::hc::{HcLabels, HcSource};
use crate::outbound::macrod_sessions::MacrodSessionsSource;
use crate::outbound::managers::ManagersSource;
use crate::outbound::run_records::RunRecordsSource;

/// Builds a fresh source for each (re)start, as the supervisor wants.
pub type SourceMaker = Box<dyn Fn() -> Box<dyn AgentSource> + Send>;

/// Where this machine's agents leave their facts.
#[derive(Clone, Debug)]
pub struct LocalSources {
    /// Where to look for `hc`, in order; a bare name is looked up on `PATH`.
    pub hc: Vec<PathBuf>,
    /// Extra hc labels to decode.
    pub hc_labels: HcLabels,
    /// Claude Code's directory (`~/.claude`).
    pub claude: PathBuf,
    /// Codex's directory (`~/.codex`).
    pub codex: PathBuf,
    /// herdr's directory (`~/.herdr`).
    pub herdr: PathBuf,
    /// macrod's home (`~/.macrod`).
    pub macrod: PathBuf,
    /// Directories of work-run records.
    pub run_record_dirs: Vec<PathBuf>,
    /// How far back transcripts are indexed and finished runs reported.
    pub history: Duration,
    /// Where to look for `gh`, in order; a bare name is looked up on `PATH`.
    pub gh: Vec<PathBuf>,
    /// How often pull request status is asked of GitHub while someone
    /// watches (`[monitor] pr_poll_secs`); `None` turns it off.
    pub pr_poll: Option<Duration>,
}

impl LocalSources {
    /// The standard layout under a user's home directory, with macrod's home
    /// given separately (it can be moved).
    pub fn in_home(home: PathBuf, macrod: PathBuf, history: Duration) -> Self {
        Self {
            // `PATH` first; `~/.local/bin`, where herdr installs it, is often
            // not on the `PATH` of a unit or a bare shell.
            hc: vec![PathBuf::from("hc"), home.join(".local/bin/hc")],
            hc_labels: HcLabels::default(),
            claude: home.join(".claude"),
            codex: home.join(".codex"),
            herdr: home.join(".herdr"),
            macrod,
            run_record_dirs: Vec::new(),
            history,
            gh: GhCli::default_programs(&home),
            pr_poll: Some(Duration::from_secs(60)),
        }
    }

    /// One maker per source.
    pub fn makers(&self) -> Vec<SourceMaker> {
        let hc = HcSource::new(self.hc.clone(), self.hc_labels.clone());
        let registry = ClaudeRegistrySource::new(self.claude.join("sessions"));
        let transcripts = ClaudeTranscriptsSource::new(self.claude.join("projects"), self.history);
        let codex = CodexRolloutsSource::new(self.codex.join("sessions"), self.history);
        let macrod = MacrodSessionsSource::new(self.macrod.join("herdr"));
        let managers = ManagersSource::new(self.herdr.join("managers"));
        let runs = RunRecordsSource::new(self.run_record_dirs.clone(), self.history);

        vec![
            Box::new(move || Box::new(hc.clone())),
            Box::new(move || Box::new(registry.clone())),
            Box::new(move || Box::new(transcripts.clone())),
            Box::new(move || Box::new(codex.clone())),
            Box::new(move || Box::new(macrod.clone())),
            Box::new(move || Box::new(managers.clone())),
            Box::new(move || Box::new(runs.clone())),
        ]
    }

    /// The GitHub pull request source, fed by the store's `interest`;
    /// `None` when `pr_poll` is off.
    pub fn github(&self, interest: PrInterest) -> Option<SourceMaker> {
        let every = self.pr_poll.filter(|every| !every.is_zero())?;
        let source = GithubSource::new(GhCli::new(self.gh.clone()), interest, every);
        Some(Box::new(move || Box::new(source.clone())))
    }
}
