//! Supported ACP agents and the local commands needed to launch them.

mod claude_code;
mod codex;
#[cfg(unix)]
mod herdr_tui;
mod hermes;
mod npm_adapter;
mod open_claw;
mod open_code;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::config::Harness;

pub use npm_adapter::AdapterInstall;

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Home;
    }
    // Windows sets no `HOME`; this is its home directory.
    #[cfg(windows)]
    macro_env_var::maybe_env_var! {
        pub struct Userprofile;
    }
}

static PRESETS: &[&dyn AgentPreset] = &[
    #[cfg(unix)]
    &herdr_tui::HerdrTui(crate::herdr::acp_agent::TuiAgent::Claude),
    #[cfg(unix)]
    &herdr_tui::HerdrTui(crate::herdr::acp_agent::TuiAgent::Codex),
    &hermes::Hermes,
    &claude_code::ClaudeCode,
    &codex::Codex,
    &open_claw::OpenClaw,
    &open_code::OpenCode,
];

/// A command and arguments that start an ACP agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    /// Command resolved through the daemon's `PATH` when a session starts.
    pub command: String,
    /// Arguments passed to the command.
    pub args: Vec<String>,
    /// Environment the agent needs on top of the daemon's own.
    pub env: BTreeMap<String, String>,
}

impl LaunchSpec {
    fn new(command: &str, args: impl IntoIterator<Item = &'static str>) -> Self {
        Self {
            command: command.to_owned(),
            args: args.into_iter().map(str::to_owned).collect(),
            env: BTreeMap::new(),
        }
    }

    fn with_env(mut self, name: &str, value: &Path) -> Self {
        self.env
            .insert(name.to_owned(), value.to_string_lossy().into_owned());
        self
    }
}

/// A supported agent whose complete launch requirements are installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedAgent {
    /// Typed preset identity used by the UI.
    pub kind: AgentKind,
    /// Human-readable agent name.
    pub name: &'static str,
    /// Launch configuration to persist when selected.
    pub launch: LaunchSpec,
    /// Short explanation for adapter-backed launchers.
    pub note: Option<&'static str>,
    /// What must be installed before `launch` can run, when anything must.
    pub install: Option<AdapterInstall>,
}

impl DetectedAgent {
    /// The name inside its group, where "in herdr" goes without saying.
    pub fn short_name(&self) -> &'static str {
        match self.kind {
            AgentKind::HerdrClaude => "Claude Code",
            AgentKind::HerdrCodex => "Codex",
            _ => self.name,
        }
    }

    /// The installation still to run before `launch` works, if any.
    pub fn pending_install(&self) -> Option<&AdapterInstall> {
        self.install
            .as_ref()
            .filter(|install| !install.is_installed())
    }
}

/// Agent identity after converting executable discovery into UI state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Hermes,
    ClaudeCode,
    HerdrClaude,
    HerdrCodex,
    Codex,
    OpenClaw,
    OpenCode,
    Custom,
}

impl AgentKind {
    /// Whether the agent runs as its own TUI in a herdr tab.
    pub fn is_herdr(self) -> bool {
        matches!(self, Self::HerdrClaude | Self::HerdrCodex)
    }

    /// Stable id used by `macrod detect-agents` and `macrod service --agent`.
    pub fn id(self) -> &'static str {
        match self {
            Self::Hermes => "hermes",
            Self::ClaudeCode => "claude-code",
            Self::HerdrClaude => "herdr-claude",
            Self::HerdrCodex => "herdr-codex",
            Self::Codex => "codex",
            Self::OpenClaw => "openclaw",
            Self::OpenCode => "opencode",
            Self::Custom => "custom",
        }
    }
}

/// Result of checking one preset against the local machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Availability {
    /// Every prerequisite exists and this launch specification can be used.
    Available(DetectedAgent),
    /// Commands that must be installed before the preset can be offered.
    Unavailable { missing: Vec<&'static str> },
}

/// Lookup boundary used by agent presets and replaced with a fake in tests.
pub trait CommandLookup {
    /// Resolve an executable through the environment's command search path.
    fn resolve(&self, command: &str) -> Option<&Path>;
    /// Directory macrod installs npm ACP adapters under, when there is one.
    fn adapter_root(&self) -> Option<&Path>;
}

/// Commands discovered on the process's `PATH`.
pub struct PathCommands {
    found: std::collections::HashMap<&'static str, PathBuf>,
    adapter_root: Option<PathBuf>,
}

impl PathCommands {
    /// Scan once for every command understood by the built-in presets.
    pub fn discover() -> Self {
        let paths = crate::executable::search_paths();
        let mut found = std::collections::HashMap::new();
        for command in [
            "hermes",
            "hermes-acp",
            "claude",
            "codex",
            "herdr",
            "npm",
            "openclaw",
            "opencode",
        ] {
            if let Some(path) = crate::executable::find(&paths, command) {
                found.insert(command, path);
            }
        }
        let home = environment::Home::new().and_then(|home| home.value().map(PathBuf::from));
        #[cfg(windows)]
        let home = home.or_else(|| {
            environment::Userprofile::new().and_then(|home| home.value().map(PathBuf::from))
        });
        let adapter_root = home.map(|home| home.join(".macrod").join("adapters"));
        Self {
            found,
            adapter_root,
        }
    }
}

impl CommandLookup for PathCommands {
    fn resolve(&self, command: &str) -> Option<&Path> {
        self.found.get(command).map(PathBuf::as_path)
    }

    fn adapter_root(&self) -> Option<&Path> {
        self.adapter_root.as_deref()
    }
}

/// One known way to expose an installed agent harness over ACP.
pub trait AgentPreset: Sync {
    /// Typed preset identity.
    fn kind(&self) -> AgentKind;
    /// Human-readable name.
    fn name(&self) -> &'static str;
    /// Resolve prerequisites and the corresponding launch specification.
    fn detect(&self, commands: &dyn CommandLookup) -> Availability;
    /// Whether an existing raw harness config represents this preset.
    fn recognizes(&self, harness: &Harness) -> bool;
}

fn direct(
    preset: &dyn AgentPreset,
    commands: &dyn CommandLookup,
    command: &'static str,
    args: impl IntoIterator<Item = &'static str>,
) -> Availability {
    if commands.resolve(command).is_none() {
        return Availability::Unavailable {
            missing: vec![command],
        };
    }
    Availability::Available(DetectedAgent {
        kind: preset.kind(),
        name: preset.name(),
        launch: LaunchSpec::new(command, args),
        note: None,
        install: None,
    })
}

fn is_launch(harness: &Harness, command: &str, args: &[&str]) -> bool {
    harness.command == command
        && harness
            .args
            .iter()
            .map(String::as_str)
            .eq(args.iter().copied())
}

/// Return installed agents in product-preference order.
pub fn discover(commands: &dyn CommandLookup) -> Vec<DetectedAgent> {
    PRESETS
        .iter()
        .filter_map(|preset| match preset.detect(commands) {
            Availability::Available(agent) => Some(agent),
            Availability::Unavailable { .. } => None,
        })
        .collect()
}

fn preset_for(harness: &Harness) -> Option<&'static dyn AgentPreset> {
    PRESETS
        .iter()
        .copied()
        .find(|preset| preset.recognizes(harness))
}

/// Friendly name for an existing launch configuration.
pub fn name_for(harness: &Harness) -> Option<&'static str> {
    preset_for(harness).map(|preset| preset.name())
}

/// Preset identity of an existing launch configuration.
pub fn kind_for(harness: &Harness) -> Option<AgentKind> {
    preset_for(harness).map(|preset| preset.kind())
}

/// Re-detect the preset an existing launch configuration came from, when its
/// prerequisites are still installed.
pub fn detected_for(harness: &Harness, commands: &dyn CommandLookup) -> Option<DetectedAgent> {
    preset_for(harness).and_then(|preset| match preset.detect(commands) {
        Availability::Available(agent) => Some(agent),
        Availability::Unavailable { .. } => None,
    })
}

/// Parse a custom command line into an ACP launch specification.
pub fn custom(command_line: &str) -> Result<DetectedAgent, String> {
    let mut parts = shell_words::split(command_line)
        .map_err(|error| format!("Could not parse the command: {error}"))?
        .into_iter();
    let command = parts
        .next()
        .filter(|command| !command.is_empty())
        .ok_or_else(|| "Command must not be empty".to_owned())?;
    Ok(DetectedAgent {
        kind: AgentKind::Custom,
        name: "Custom command",
        launch: LaunchSpec {
            command,
            args: parts.collect(),
            env: BTreeMap::new(),
        },
        note: None,
        install: None,
    })
}
