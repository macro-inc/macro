//! `macrod teammate`: the owner's view of the teammates this machine hosts.

use std::ffi::OsString;
use std::io::{BufRead as _, Write as _};
use std::process::Stdio;

use agent_runtime_protocol::domain::schema::v0::TeammateInstallId;
use rootcause::prelude::ResultExt as _;
use tokio::io::AsyncWriteExt as _;

use super::cli::CliEngine;
use super::engine::{Engine, PROVIDER_TARGET, container_name, network_name, provider_volume_name};
use super::store::{Store, StoredInstall, teammates_directory};

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
        /// The install id, from `macrod teammate list`.
        #[arg(value_parser = install_id)]
        install: TeammateInstallId,
    },
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
        TeammateCommand::SignIn { install } => sign_in(&install).await,
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

async fn list() -> rootcause::Result<()> {
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
        let id = &stored.install.install_id;
        let container = if engine_found {
            match engine.container(&container_name(id)).await {
                Ok(Some(state)) if state.running => "running",
                Ok(Some(_)) => "exited",
                Ok(None) => "absent",
                Err(_) => "unknown",
            }
        } else {
            "no engine"
        };
        let image = stored
            .image
            .image_id
            .strip_prefix("sha256:")
            .unwrap_or(&stored.image.image_id);
        println!(
            "{:<40} {:>10}  {:<12}  {container}",
            id.as_str(),
            stored.install.generation,
            image.chars().take(12).collect::<String>(),
        );
    }
    Ok(())
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
async fn sign_in(install: &TeammateInstallId) -> rootcause::Result<()> {
    let stored = kept_installs()?
        .into_iter()
        .find(|stored| &stored.install.install_id == install)
        .ok_or_else(|| {
            rootcause::report!("no teammate install {} on this machine", install.as_str())
        })?;

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
