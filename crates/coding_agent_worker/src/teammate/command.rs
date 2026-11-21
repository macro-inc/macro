//! `macrod teammate`: the owner's view of the teammates this machine hosts.

use std::ffi::OsString;
use std::io::{BufRead as _, Write as _};
use std::process::Stdio;

use agent_runtime_protocol::domain::schema::v0::TeammateInstallId;
use rootcause::prelude::ResultExt as _;
use tokio::io::AsyncWriteExt as _;

use super::cli::CliEngine;
use super::engine::{
    ContainerState, Engine, PROVIDER_TARGET, container_name, network_name, provider_volume_name,
};
use super::store::{Store, StoredInstall, teammates_directory};
use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngineKind, EngineIsolation, TeammateHostReport,
};

/// What `macrod teammate` does.
#[derive(Debug, clap::Subcommand)]
pub enum TeammateCommand {
    /// List the teammates this machine keeps, with their containers' state.
    List,
    /// Show a teammate container's logs.
    Logs {
        /// The install id, from `macrod teammate list`.
        #[arg(value_parser = install_id)]
        install: TeammateInstallId,
        /// Keep printing new lines.
        #[arg(long, short)]
        follow: bool,
        /// Lines from the end to start at.
        #[arg(long, default_value_t = 200)]
        tail: u32,
    },
    /// Sign a teammate in with your own Claude plan: runs `claude setup-token`
    /// in a separate container that sees only the teammate's provider volume.
    SignIn {
        /// The install id, from `macrod teammate list`; needed only when
        /// the machine keeps more than one.
        #[arg(value_parser = install_id)]
        install: Option<TeammateInstallId>,
    },
    /// Print the egress ruleset for the JSON on stdin (`{"allow": [...],
    /// "facts": {...}}`), for the image's egress test.
    #[command(hide = true)]
    Ruleset,
}

/// The input of `macrod teammate ruleset`.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RulesetInput {
    #[serde(default)]
    allow: Vec<super::egress::Allow>,
    facts: super::egress::NetworkFacts,
}

fn install_id(value: &str) -> Result<TeammateInstallId, String> {
    TeammateInstallId::new(value).map_err(|error| error.to_string())
}

/// Run a `macrod teammate` command.
pub async fn run(command: TeammateCommand) -> rootcause::Result<()> {
    match command {
        TeammateCommand::List => list().await,
        TeammateCommand::Logs {
            install,
            follow,
            tail,
        } => logs(&install, follow, tail).await,
        TeammateCommand::SignIn { install } => sign_in(install.as_ref()).await,
        TeammateCommand::Ruleset => {
            let input: RulesetInput = serde_json::from_reader(std::io::stdin())
                .context("the input is not {\"allow\": [...], \"facts\": {...}}")?;
            let allow = input
                .allow
                .into_iter()
                .map(super::egress::Allow::validated)
                .collect::<Result<Vec<_>, _>>()
                .context("an allow entry is refused")?;
            print!("{}", super::egress::ruleset(&allow, &input.facts));
            Ok(())
        }
    }
}

/// Every kept install on this machine, from every harness's store.
fn kept_installs() -> rootcause::Result<Vec<StoredInstall>> {
    let root = teammates_directory()?;
    let harnesses = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(rootcause::report!(
                "could not read {}: {error}",
                root.display()
            ));
        }
    };
    Ok(harnesses
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .flat_map(|entry| Store::new(entry.path()).installs())
        .collect())
}

/// The last host report any harness's store kept.
fn kept_host_report() -> Option<TeammateHostReport> {
    let root = teammates_directory().ok()?;
    std::fs::read_dir(&root)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .find_map(|entry| Store::new(entry.path()).host_report())
}

/// The `macrod teammate list` header: every installed engine, whether it
/// enforces isolation, and which one runs teammates.
pub fn engines_line(report: &TeammateHostReport) -> String {
    if report.engines.is_empty() {
        return "engines: none installed".to_owned();
    }
    let chosen = report.engine.as_ref().map(|engine| engine.kind);
    let engines: Vec<String> = report
        .engines
        .iter()
        .map(|engine| {
            let kind = match engine.kind {
                ContainerEngineKind::Docker => "docker",
                ContainerEngineKind::Podman => "podman",
            };
            let version = engine.version.as_deref().unwrap_or("(no answer)");
            let rootless = if engine.rootless { " rootless" } else { "" };
            let isolation = match engine.isolation {
                EngineIsolation::Enforced => "isolation ok".to_owned(),
                EngineIsolation::NotProbed => "isolation not probed yet".to_owned(),
                EngineIsolation::Unavailable { reason } => {
                    format!(
                        "isolation unavailable ({})",
                        serde_json::to_value(reason)
                            .ok()
                            .and_then(|value| value.as_str().map(str::to_owned))
                            .unwrap_or_default()
                    )
                }
            };
            let marker = if chosen == Some(engine.kind) {
                " (runs teammates)"
            } else {
                ""
            };
            format!("{kind} {version}{rootless}: {isolation}{marker}")
        })
        .collect();
    format!("engines: {}", engines.join(" · "))
}

async fn list() -> rootcause::Result<()> {
    if let Some(report) = kept_host_report() {
        println!("{}", engines_line(&report));
    }
    let installs = kept_installs()?;
    if installs.is_empty() {
        println!("No teammates on this machine.");
        return Ok(());
    }
    let engine = CliEngine::new();
    let engine_found = engine.info().await.is_ok();
    println!(
        "{:<40} {:>10}  {:<12}  CONTAINER",
        "INSTALL", "GENERATION", "IMAGE"
    );
    for stored in installs {
        let observed = if engine_found {
            match engine
                .container(&container_name(&stored.install.install_id))
                .await
            {
                Ok(Some(state)) => Observed::Container(state),
                Ok(None) => Observed::Absent,
                Err(_) => Observed::Unknown,
            }
        } else {
            Observed::NoEngine
        };
        println!("{}", list_row(&stored, &observed));
    }
    Ok(())
}

/// What the engine says about an install's container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observed {
    /// No engine answered.
    NoEngine,
    /// The engine didn't say.
    Unknown,
    /// There is no container.
    Absent,
    /// The container, as the engine sees it.
    Container(ContainerState),
}

/// One `macrod teammate list` row: the image the container actually runs
/// (the kept image when none runs), and whether it is the rolled-back one.
pub fn list_row(stored: &StoredInstall, observed: &Observed) -> String {
    let image_id = match observed {
        Observed::Container(state) => state.image_id.as_deref(),
        Observed::NoEngine | Observed::Unknown | Observed::Absent => None,
    }
    .unwrap_or(stored.image.image_id.as_str());
    let short: String = image_id
        .strip_prefix("sha256:")
        .unwrap_or(image_id)
        .chars()
        .take(12)
        .collect();
    let rolled_back = stored
        .lifecycle
        .update
        .as_ref()
        .and_then(teammate_lifecycle::replacement::ImageUpdate::rolled_back);
    let container = match observed {
        Observed::Container(state) if state.running => match rolled_back {
            Some(reason) => format!("running, rolled back ({reason})"),
            None => "running".to_owned(),
        },
        Observed::Container(_) => "exited".to_owned(),
        Observed::Absent => "absent".to_owned(),
        Observed::Unknown => "unknown".to_owned(),
        Observed::NoEngine => "no engine".to_owned(),
    };
    format!(
        "{:<40} {:>10}  {:<12}  {container}",
        stored.install.install_id.as_str(),
        stored.install.generation,
        short,
    )
}

async fn logs(install: &TeammateInstallId, follow: bool, tail: u32) -> rootcause::Result<()> {
    let engine = CliEngine::new();
    let mut command = engine.command().await.map_err(|unavailable| {
        rootcause::report!("no container engine answered: {unavailable:?}")
    })?;
    command.args(["logs", "--tail", &tail.to_string()]);
    if follow {
        command.arg("--follow");
    }
    let status = command
        .arg(container_name(install))
        .status()
        .await
        .context("could not run the engine")?;
    if !status.success() {
        rootcause::bail!("the engine could not show the logs ({status})");
    }
    Ok(())
}

/// `claude setup-token` in a short-lived container of the teammate's image,
/// with the provider volume and nothing else: no agent credentials, no
/// agent volume. The CLI prints the token on its screen; the owner pastes
/// it back, and a second short-lived container writes it to
/// `/teammate-provider/claude/credential.json` (0600, uid 1000), where the
/// agent reads it through its read-only mount.
/// The install a command acts on: the one asked for, or the machine's
/// only one; else why not.
pub fn chosen_install(
    installs: Vec<StoredInstall>,
    asked: Option<&TeammateInstallId>,
) -> Result<StoredInstall, String> {
    if let Some(asked) = asked {
        return installs
            .into_iter()
            .find(|stored| &stored.install.install_id == asked)
            .ok_or_else(|| format!("no teammate install {} on this machine", asked.as_str()));
    }
    match installs.len() {
        0 => Err("no teammates on this machine".to_owned()),
        1 => installs
            .into_iter()
            .next()
            .ok_or_else(|| "no teammates on this machine".to_owned()),
        count => {
            let ids: Vec<String> = installs
                .iter()
                .map(|stored| format!("  {}", stored.install.install_id.as_str()))
                .collect();
            Err(format!(
                "this machine keeps {count} teammates; name one: macrod teammate sign-in <install>\n{}",
                ids.join("\n")
            ))
        }
    }
}

async fn sign_in(asked: Option<&TeammateInstallId>) -> rootcause::Result<()> {
    let stored =
        chosen_install(kept_installs()?, asked).map_err(|reason| rootcause::report!("{reason}"))?;
    let install = &stored.install.install_id;

    let engine = CliEngine::new();
    engine.info().await.map_err(|unavailable| {
        rootcause::report!("no container engine answered: {unavailable:?}")
    })?;
    let network = network_name(install);
    engine
        .create_network(&network)
        .await
        .context("could not create the teammate network")?;
    let provider = provider_volume_name(install);
    engine
        .create_volume(&provider)
        .await
        .context("could not create the provider volume")?;

    let arguments = |terminal: &[&str], entrypoint: &str| -> Vec<OsString> {
        let mut arguments: Vec<OsString> = vec!["run".into(), "--rm".into()];
        arguments.extend(terminal.iter().map(OsString::from));
        arguments.extend(
            [
                "--user".to_owned(),
                "1000:1000".to_owned(),
                "--read-only".to_owned(),
                "--cap-drop=ALL".to_owned(),
                "--security-opt=no-new-privileges".to_owned(),
                "--tmpfs".to_owned(),
                "/tmp".to_owned(),
                // Claude Code writes its own settings under HOME; the root is
                // read-only and nothing of this run is kept but the sign-in.
                "--env".to_owned(),
                "HOME=/tmp".to_owned(),
                "--network".to_owned(),
                network.clone(),
                "--mount".to_owned(),
                format!("type=volume,src={provider},dst={PROVIDER_TARGET}"),
                "--entrypoint".to_owned(),
                entrypoint.to_owned(),
                stored.image.image_id.clone(),
            ]
            .into_iter()
            .map(OsString::from),
        );
        arguments
    };

    let mut setup = engine.command().await.map_err(|unavailable| {
        rootcause::report!("no container engine answered: {unavailable:?}")
    })?;
    let status = setup
        .args(arguments(&["--interactive", "--tty"], "claude"))
        .arg("setup-token")
        .status()
        .await
        .context("could not run claude setup-token")?;
    if !status.success() {
        rootcause::bail!("claude setup-token did not finish ({status})");
    }

    print!("Paste the token it printed (sk-ant-…): ");
    std::io::stdout().flush().context("could not prompt")?;
    let mut token = zeroize::Zeroizing::new(String::new());
    std::io::stdin()
        .lock()
        .read_line(&mut token)
        .context("could not read the token")?;
    let token = token.trim();
    if !token.starts_with("sk-ant-") || token.chars().any(char::is_whitespace) {
        rootcause::bail!("that is not a Claude token");
    }

    // The shape harnessd stores, which the image's `claude` wrapper reads.
    let credential = zeroize::Zeroizing::new(
        serde_json::json!({
            "token": token,
            "expires_at": null,
            "created_at": chrono::Utc::now(),
        })
        .to_string(),
    );
    let mut write = engine.command().await.map_err(|unavailable| {
        rootcause::report!("no container engine answered: {unavailable:?}")
    })?;
    let mut child = write
        .args(arguments(&["--interactive"], "sh"))
        .args([
            "-c",
            "umask 077 && mkdir -p /teammate-provider/claude && \
             cat > /teammate-provider/claude/.credential.json.partial && \
             mv /teammate-provider/claude/.credential.json.partial /teammate-provider/claude/credential.json",
        ])
        .stdin(Stdio::piped())
        .spawn()
        .context("could not start the engine")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| rootcause::report!("the engine took no input"))?;
    stdin
        .write_all(credential.as_bytes())
        .await
        .context("could not hand the token over")?;
    drop(stdin);
    let status = child.wait().await.context("could not write the sign-in")?;
    if !status.success() {
        rootcause::bail!("could not write the sign-in ({status})");
    }
    println!("Signed in. The teammate uses your Claude plan from its next start.");
    Ok(())
}
