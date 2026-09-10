use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::*;

struct Commands(HashMap<&'static str, PathBuf>);

impl Commands {
    fn new(commands: &[&'static str]) -> Self {
        Self(
            commands
                .iter()
                .map(|command| (*command, PathBuf::from(format!("/bin/{command}"))))
                .collect(),
        )
    }
}

impl CommandLookup for Commands {
    fn resolve(&self, command: &str) -> Option<&Path> {
        self.0.get(command).map(PathBuf::as_path)
    }
}

#[test]
fn direct_agents_need_only_their_command() {
    let agents = discover(&Commands::new(&["hermes", "openclaw", "opencode"]));

    assert_eq!(
        agents.iter().map(|agent| agent.kind).collect::<Vec<_>>(),
        [AgentKind::Hermes, AgentKind::OpenClaw, AgentKind::OpenCode]
    );
    assert_eq!(agents[0].launch, LaunchSpec::new("hermes", ["acp"]));
}

#[test]
fn hermes_acp_launcher_is_used_as_a_fallback() {
    let agents = discover(&Commands::new(&["hermes-acp"]));

    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].launch, LaunchSpec::new("hermes-acp", []));
}

#[test]
fn adapter_agents_require_the_cli_and_npm_tooling() {
    assert!(discover(&Commands::new(&["claude", "npm"])).is_empty());

    let agents = discover(&Commands::new(&["claude", "codex", "npm", "npx"]));
    assert_eq!(
        agents.iter().map(|agent| agent.kind).collect::<Vec<_>>(),
        [AgentKind::ClaudeCode, AgentKind::Codex]
    );
    assert_eq!(agents[0].launch.command, "npx");
    assert_eq!(agents[0].note, Some("via npm ACP adapter"));
}

#[test]
fn existing_launch_specs_are_recognized() {
    let harness = Harness {
        command: "hermes".to_owned(),
        args: vec!["acp".to_owned()],
    };
    assert_eq!(name_for(&harness), Some("Hermes Agent"));

    let custom = Harness {
        command: "my-agent".to_owned(),
        args: Vec::new(),
    };
    assert_eq!(name_for(&custom), None);
}

#[test]
fn custom_commands_preserve_quoted_arguments() {
    let agent = custom(r#"my-agent --mode acp --name "Macro Agent""#).expect("custom command");

    assert_eq!(agent.launch.command, "my-agent");
    assert_eq!(
        agent.launch.args,
        ["--mode", "acp", "--name", "Macro Agent"]
    );
}
