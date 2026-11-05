use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use super::*;

const ADAPTER_ROOT: &str = "/home/test/.macrod/adapters";

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

    fn adapter_root(&self) -> Option<&Path> {
        Some(Path::new(ADAPTER_ROOT))
    }
}

fn harness(command: &str, args: &[&str]) -> Harness {
    Harness {
        command: command.to_owned(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        env: BTreeMap::new(),
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
    assert_eq!(agents[0].install, None);
}

#[test]
fn hermes_acp_launcher_is_used_as_a_fallback() {
    let agents = discover(&Commands::new(&["hermes-acp"]));

    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].launch, LaunchSpec::new("hermes-acp", []));
}

#[test]
fn adapter_agents_require_the_cli_and_npm() {
    assert!(discover(&Commands::new(&["claude"])).is_empty());
    assert!(discover(&Commands::new(&["npm"])).is_empty());

    let agents = discover(&Commands::new(&["claude", "codex", "npm"]));
    assert_eq!(
        agents.iter().map(|agent| agent.kind).collect::<Vec<_>>(),
        [AgentKind::ClaudeCode, AgentKind::Codex]
    );
    assert_eq!(agents[0].note, Some("via npm ACP adapter"));
}

#[test]
fn adapter_agents_launch_the_pinned_install_directly() {
    let agents = discover(&Commands::new(&["codex", "npm"]));
    let codex = &agents[0];

    let prefix = format!("{ADAPTER_ROOT}/@agentclientprotocol/codex-acp@1.8.0");
    assert_eq!(
        codex.launch.command,
        format!("{prefix}/node_modules/.bin/codex-acp")
    );
    assert!(codex.launch.args.is_empty());
    let install = codex.install.as_ref().expect("adapter needs installing");
    assert_eq!(install.package, "@agentclientprotocol/codex-acp@1.8.0");
    assert_eq!(install.prefix, Path::new(&prefix));
    assert_eq!(install.bin, Path::new(&codex.launch.command));
}

#[test]
fn adapter_agents_point_the_adapter_at_the_installed_cli() {
    let agents = discover(&Commands::new(&["claude", "codex", "npm"]));

    assert_eq!(
        agents[0].launch.env,
        BTreeMap::from([(
            "CLAUDE_CODE_EXECUTABLE".to_owned(),
            "/bin/claude".to_owned()
        )])
    );
    assert_eq!(
        agents[1].launch.env,
        BTreeMap::from([("CODEX_PATH".to_owned(), "/bin/codex".to_owned())])
    );
}

#[test]
fn claude_code_gets_the_program_behind_an_npm_cmd_shim() {
    // Windows npm installs `claude.cmd`. The Claude SDK spawns
    // `CLAUDE_CODE_EXECUTABLE` without a shell, and Node refuses `.cmd` files
    // there, so the adapter must get the binary the shim runs. codex-acp is a
    // native program that launches `.cmd` files itself.
    let npm = tempfile::tempdir().expect("temp dir");
    let claude = npm.path().join("claude.cmd");
    std::fs::write(
        &claude,
        "@ECHO off\r\nCALL :find_dp0\r\n\"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"   %*\r\n",
    )
    .expect("write shim");
    let codex = npm.path().join("codex.cmd");
    std::fs::write(
        &codex,
        "@ECHO off\r\n\"%_prog%\"  \"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js\" %*\r\n",
    )
    .expect("write shim");
    let commands = Commands(HashMap::from([
        ("claude", claude),
        ("codex", codex.clone()),
        ("npm", npm.path().join("npm.cmd")),
    ]));

    let agents = discover(&commands);

    assert_eq!(
        agents[0].launch.env,
        BTreeMap::from([(
            "CLAUDE_CODE_EXECUTABLE".to_owned(),
            npm.path()
                .join("node_modules/@anthropic-ai/claude-code/bin/claude.exe")
                .to_string_lossy()
                .into_owned()
        )])
    );
    assert_eq!(
        agents[1].launch.env,
        BTreeMap::from([(
            "CODEX_PATH".to_owned(),
            codex.to_string_lossy().into_owned()
        )])
    );
}

#[test]
fn existing_launch_specs_are_recognized() {
    assert_eq!(name_for(&harness("hermes", &["acp"])), Some("Hermes Agent"));
    assert_eq!(name_for(&harness("my-agent", &[])), None);
    assert_eq!(kind_for(&harness("my-agent", &[])), None);
}

#[test]
fn adapter_configs_are_recognized_however_they_were_written() {
    // Written by releases that launched through npx.
    let legacy = harness("npx", &["-y", "@agentclientprotocol/codex-acp@1.8.0"]);
    assert_eq!(kind_for(&legacy), Some(AgentKind::Codex));

    let installed = harness(
        "/somewhere/else/@agentclientprotocol/codex-acp@1.8.0/node_modules/.bin/codex-acp",
        &[],
    );
    assert_eq!(name_for(&installed), Some("Codex CLI"));

    let other_version = harness(
        "/somewhere/else/@agentclientprotocol/codex-acp@1.7.0/node_modules/.bin/codex-acp",
        &[],
    );
    assert_eq!(name_for(&other_version), None);

    let with_arguments = harness(
        "/somewhere/else/@agentclientprotocol/codex-acp@1.8.0/node_modules/.bin/codex-acp",
        &["--verbose"],
    );
    assert_eq!(name_for(&with_arguments), None);
}

#[tokio::test]
async fn an_installed_adapter_is_not_installed_again() {
    let root = tempfile::tempdir().expect("temp dir");
    let bin = root.path().join("codex-acp");
    std::fs::write(&bin, "").expect("write stand-in executable");
    let install = AdapterInstall {
        package: "@agentclientprotocol/codex-acp@1.8.0",
        prefix: root.path().to_owned(),
        bin,
    };

    let agents = discover(&Commands::new(&["codex", "npm"]));
    let mut codex = agents[0].clone();
    codex.install = Some(install.clone());

    assert!(install.is_installed());
    assert_eq!(codex.pending_install(), None);
    // Nothing to fetch, so this returns without running npm at all.
    install.run().await.expect("present install is a no-op");
}

#[test]
fn custom_commands_preserve_quoted_arguments() {
    let agent = custom(r#"my-agent --mode acp --name "Macro Agent""#).expect("custom command");

    assert_eq!(agent.launch.command, "my-agent");
    assert_eq!(
        agent.launch.args,
        ["--mode", "acp", "--name", "Macro Agent"]
    );
    assert!(agent.launch.env.is_empty());
    assert_eq!(agent.install, None);
}
