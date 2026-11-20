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

#[cfg(unix)]
#[test]
fn a_failed_install_reports_npm_s_reason_not_its_log_line() {
    use std::os::unix::process::ExitStatusExt as _;
    let stderr = "\
npm error code ETARGET
npm error notarget No matching version found for @agentclientprotocol/codex-acp@0.0.0.
npm error notarget In most cases you or one of your dependencies are requesting
npm error notarget a package version that doesn't exist.
npm error A complete log of this run can be found in: /home/test/.npm/_logs/debug-0.log
";
    assert_eq!(
        npm_adapter::failure_summary(stderr, std::process::ExitStatus::from_raw(1 << 8)),
        "notarget No matching version found for @agentclientprotocol/codex-acp@0.0.0. \
         In most cases you or one of your dependencies are requesting \
         a package version that doesn't exist.; code ETARGET \
         (npm log: /home/test/.npm/_logs/debug-0.log)"
    );
}

#[cfg(unix)]
#[test]
fn a_silent_npm_failure_reports_its_exit_status() {
    use std::os::unix::process::ExitStatusExt as _;
    assert_eq!(
        npm_adapter::failure_summary("\n", std::process::ExitStatus::from_raw(1 << 8)),
        "npm exited with exit status: 1 and no error output"
    );
}

#[cfg(unix)]
#[test]
fn a_log_path_on_the_next_line_is_kept() {
    use std::os::unix::process::ExitStatusExt as _;
    let stderr = "npm ERR! boom\nnpm ERR! A complete log of this run can be found in:\nnpm ERR!     /x/debug.log\n";
    assert_eq!(
        npm_adapter::failure_summary(stderr, std::process::ExitStatus::from_raw(1 << 8)),
        "boom (npm log: /x/debug.log)"
    );
}

#[cfg(unix)]
#[test]
fn a_herdr_core_terminal_runs_herdr_agents_through_the_hc_it_names() {
    let agent = herdr_tui::HerdrTui(crate::herdr::acp_agent::TuiAgent::Claude);
    let terminal = crate::herdr::HerdrSession::Core {
        bin: PathBuf::from("/opt/herdr-core/bin/hc"),
        terminal: "t3".to_owned(),
    };

    // `hc` is not on PATH: herdr-core's terminal environment names it.
    let available = agent.availability(Ok(Some(terminal)), &Commands::new(&["claude"]));
    assert!(
        matches!(available, Availability::Available(_)),
        "{available:?}"
    );

    let unnamed = agent.availability(Err(crate::herdr::HcBinMissing), &Commands::new(&["claude"]));
    assert!(
        matches!(&unnamed, Availability::Unavailable { missing } if missing == &["HC_BIN"]),
        "{unnamed:?}"
    );
}

#[cfg(unix)]
#[test]
fn a_root_owned_npm_cache_reports_the_fix_npm_suggests() {
    use std::os::unix::process::ExitStatusExt as _;
    // npm 11's output in macOS 14 with a cache it cannot write, as captured
    // on a Mac: the fix is the chown line, after two prose paragraphs and
    // npm's update notice.
    let stderr = r#"npm error code EACCES
npm error syscall mkdir
npm error path /Users/test/.npm/_cacache
npm error errno EACCES
npm error
npm error Your cache folder contains root-owned files, due to a bug in
npm error previous versions of npm which has since been addressed.
npm error
npm error To permanently fix this problem, please run:
npm error   sudo chown -R 501:20 "/Users/test/.npm"
npm notice
npm notice New minor version of npm available! 11.6.2 -> 11.21.3
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.21.3
npm notice To update run: npm install -g npm@11.21.3
npm notice
npm error Log files were not written due to an error writing to the directory: /Users/test/.npm/_logs
npm error You can rerun the command with `--loglevel=verbose` to see the logs in your terminal
"#;
    assert_eq!(
        npm_adapter::failure_summary(stderr, std::process::ExitStatus::from_raw(1 << 8)),
        "Your cache folder contains root-owned files, due to a bug in \
         previous versions of npm which has since been addressed.; \
         To permanently fix this problem, please run: \
         sudo chown -R 501:20 \"/Users/test/.npm\"; \
         Log files were not written due to an error writing to the directory: \
         /Users/test/.npm/_logs You can rerun the command with \
         `--loglevel=verbose` to see the logs in your terminal"
    );
}

#[cfg(unix)]
#[test]
fn an_unpublished_adapter_reports_npm_s_404_paragraphs() {
    use std::os::unix::process::ExitStatusExt as _;
    // npm separates the paragraphs of a titled section with a line holding
    // only the title.
    let stderr = "\
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@agentclientprotocol%2fnope - Not found
npm error 404
npm error 404  '@agentclientprotocol/nope@0.1.0' is not in this registry.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/test/.npm/_logs/debug-0.log
";
    assert_eq!(
        npm_adapter::failure_summary(stderr, std::process::ExitStatus::from_raw(1 << 8)),
        "404 Not Found - GET https://registry.npmjs.org/@agentclientprotocol%2fnope - Not found; \
         '@agentclientprotocol/nope@0.1.0' is not in this registry.; \
         Note that you can also install from a tarball, folder, http url, or git url. \
         (npm log: /home/test/.npm/_logs/debug-0.log)"
    );
}

#[cfg(unix)]
#[test]
fn an_offline_install_reports_npm_s_network_paragraphs() {
    use std::os::unix::process::ExitStatusExt as _;
    let stderr = "\
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/x failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
npm error network
npm error network If you are behind a proxy, please make sure that the
npm error network 'proxy' config is set properly.  See: 'npm help config'
npm error A complete log of this run can be found in: /home/test/.npm/_logs/debug-0.log
";
    assert_eq!(
        npm_adapter::failure_summary(stderr, std::process::ExitStatus::from_raw(1 << 8)),
        "network request to https://registry.npmjs.org/x failed, reason: getaddrinfo ENOTFOUND \
         registry.npmjs.org This is a problem related to network connectivity. In most cases \
         you are behind a proxy or have bad network settings.; If you are behind a proxy, \
         please make sure that the 'proxy' config is set properly.  See: 'npm help config'; \
         code ENOTFOUND (npm log: /home/test/.npm/_logs/debug-0.log)"
    );
}

#[cfg(unix)]
#[test]
fn metadata_and_prose_words_are_not_titles() {
    use std::os::unix::process::ExitStatusExt as _;
    let stderr = "\
npm error boom
npm error code X
npm error other
npm error
npm error To fix this, run:
npm error To be sure, run it twice.
";
    assert_eq!(
        npm_adapter::failure_summary(stderr, std::process::ExitStatus::from_raw(1 << 8)),
        "boom; other; To fix this, run: To be sure, run it twice."
    );
}

#[cfg(unix)]
#[test]
fn a_long_install_script_failure_is_clipped() {
    use std::os::unix::process::ExitStatusExt as _;
    let stderr = format!(
        "npm error command failed\nnpm error command sh -c node install.js\n{}",
        "npm error gyp info it worked if it ends with ok\n".repeat(40)
    );
    let summary = npm_adapter::failure_summary(&stderr, std::process::ExitStatus::from_raw(1 << 8));
    assert_eq!(summary.chars().count(), 301);
    assert!(
        summary.starts_with("command failed sh -c node install.js gyp info it worked"),
        "{summary}"
    );
    assert!(summary.ends_with('…'), "{summary}");
}
