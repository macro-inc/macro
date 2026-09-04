//! Supported ACP agents and the local commands needed to launch them.

mod claude_code;
mod codex;
mod hermes;
mod open_claw;
mod open_code;

use std::path::{Path, PathBuf};

use crate::config::Harness;

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Path;
    }
}

static PRESETS: &[&dyn AgentPreset] = &[
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
}

impl LaunchSpec {
    fn new(command: &str, args: impl IntoIterator<Item = &'static str>) -> Self {
        Self {
            command: command.to_owned(),
            args: args.into_iter().map(str::to_owned).collect(),
        }
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
}

/// Agent identity after converting executable discovery into UI state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Hermes,
    ClaudeCode,
    Codex,
    OpenClaw,
    OpenCode,
    Custom,
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
}

/// Commands discovered on the process's `PATH`.
pub struct PathCommands {
    found: std::collections::HashMap<&'static str, PathBuf>,
}

impl PathCommands {
    /// Scan once for every command understood by the built-in presets.
    pub fn discover() -> Self {
        let paths = environment::Path::new()
            .and_then(|path| path.value().map(std::ffi::OsString::from))
            .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .unwrap_or_default();
        let mut found = std::collections::HashMap::new();
        for command in [
            "hermes",
            "hermes-acp",
            "claude",
            "codex",
            "npm",
            "npx",
            "openclaw",
            "opencode",
        ] {
            if let Some(path) = find_command(&paths, command) {
                found.insert(command, path);
            }
        }
        Self { found }
    }
}

fn find_command(paths: &[PathBuf], command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = [
        command.to_owned(),
        format!("{command}.exe"),
        format!("{command}.cmd"),
        format!("{command}.bat"),
    ];
    #[cfg(not(windows))]
    let names = [command.to_owned()];

    paths
        .iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

impl CommandLookup for PathCommands {
    fn resolve(&self, command: &str) -> Option<&Path> {
        self.found.get(command).map(PathBuf::as_path)
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
    })
}

fn npm_adapter(
    preset: &dyn AgentPreset,
    commands: &dyn CommandLookup,
    cli: &'static str,
    package: &'static str,
) -> Availability {
    let missing = [cli, "npm", "npx"]
        .into_iter()
        .filter(|command| commands.resolve(command).is_none())
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Availability::Unavailable { missing };
    }
    Availability::Available(DetectedAgent {
        kind: preset.kind(),
        name: preset.name(),
        launch: LaunchSpec::new("npx", ["-y", package]),
        note: Some("via npm ACP adapter"),
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

/// Friendly name for an existing launch configuration.
pub fn name_for(harness: &Harness) -> Option<&'static str> {
    PRESETS
        .iter()
        .find(|preset| preset.recognizes(harness))
        .map(|preset| preset.name())
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
        },
        note: None,
    })
}
