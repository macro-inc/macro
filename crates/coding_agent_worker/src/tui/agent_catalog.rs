//! Supported ACP agents and the local commands needed to launch them.

use std::path::{Path, PathBuf};

use crate::config::Harness;

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Path;
    }
}

const CLAUDE_ADAPTER: &str = "@agentclientprotocol/claude-agent-acp@0.73.0";
const CODEX_ADAPTER: &str = "@agentclientprotocol/codex-acp@1.8.0";

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
    /// Stable identifier used by the UI.
    pub id: &'static str,
    /// Human-readable agent name.
    pub name: &'static str,
    /// Launch configuration to persist when selected.
    pub launch: LaunchSpec,
    /// Short explanation for adapter-backed launchers.
    pub note: Option<&'static str>,
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

/// One known way to expose an installed coding agent over ACP.
pub trait AgentPreset: Sync {
    /// Stable preset identifier.
    fn id(&self) -> &'static str;
    /// Human-readable name.
    fn name(&self) -> &'static str;
    /// Resolve prerequisites and the corresponding launch specification.
    fn detect(&self, commands: &dyn CommandLookup) -> Availability;
    /// Whether an existing raw harness config represents this preset.
    fn recognizes(&self, harness: &Harness) -> bool;
}

struct Hermes;
struct ClaudeCode;
struct Codex;
struct OpenClaw;
struct OpenCode;

static HERMES: Hermes = Hermes;
static CLAUDE_CODE: ClaudeCode = ClaudeCode;
static CODEX: Codex = Codex;
static OPENCLAW: OpenClaw = OpenClaw;
static OPENCODE: OpenCode = OpenCode;

static PRESETS: &[&dyn AgentPreset] = &[&HERMES, &CLAUDE_CODE, &CODEX, &OPENCLAW, &OPENCODE];

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
        id: preset.id(),
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
        id: preset.id(),
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

impl AgentPreset for Hermes {
    fn id(&self) -> &'static str {
        "hermes"
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

impl AgentPreset for ClaudeCode {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn name(&self) -> &'static str {
        "Claude Code"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        npm_adapter(self, commands, "claude", CLAUDE_ADAPTER)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "npx", &["-y", CLAUDE_ADAPTER])
    }
}

impl AgentPreset for Codex {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn name(&self) -> &'static str {
        "Codex CLI"
    }

    fn detect(&self, commands: &dyn CommandLookup) -> Availability {
        npm_adapter(self, commands, "codex", CODEX_ADAPTER)
    }

    fn recognizes(&self, harness: &Harness) -> bool {
        is_launch(harness, "npx", &["-y", CODEX_ADAPTER])
    }
}

impl AgentPreset for OpenClaw {
    fn id(&self) -> &'static str {
        "openclaw"
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

impl AgentPreset for OpenCode {
    fn id(&self) -> &'static str {
        "opencode"
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
