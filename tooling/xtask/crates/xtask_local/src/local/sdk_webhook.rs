//! Instance-local relay for SDK webhook receivers running on the host.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

use super::instance::{Instance, Port};
use super::stage::Stage;

const RELAY_PORT: u16 = 8787;
const USER: &str = "sdk-webhook";

/// How long a single spawned `ssh` must stay alive before we call the tunnel
/// up. Long enough for a refused/reset connect to have surfaced, short enough
/// that it costs nothing on the happy path.
const SETTLE: Duration = Duration::from_millis(300);

/// How long to keep retrying the connect. `bring_up_app` runs `docker compose
/// up -d` without `--wait`, and the relay has no healthcheck, so compose
/// returns once the container is *created* — before its `ssh-keygen -A &&
/// sshd` is listening. On Docker Desktop the published port answers and then
/// resets during that window, so ssh dies instantly (255) rather than blocking
/// on connect, and a single attempt loses the race on most Macs.
const READY_TIMEOUT: Duration = Duration::from_secs(15);

/// Pause between connect attempts.
const RETRY_DELAY: Duration = Duration::from_millis(250);

pub fn relay_url() -> &'static str {
    "http://sdk-webhook-relay:8787/macro-events"
}

pub fn ssh_port(instance: &Instance) -> u16 {
    instance.port(Port::SdkWebhookSsh)
}

pub fn host_receiver_port(instance: &Instance) -> u16 {
    instance.port(Port::SdkWebhookHostReceiver)
}

pub fn key_dir(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("sdk-webhook")
}

fn private_key(instance: &Instance) -> PathBuf {
    key_dir(instance).join("id_ed25519")
}

fn public_key(instance: &Instance) -> PathBuf {
    key_dir(instance).join("id_ed25519.pub")
}

fn pid_path(instance: &Instance) -> PathBuf {
    key_dir(instance).join("tunnel.pid")
}

/// Create the per-instance client key pair used by the relay container.
pub fn ensure_keys(instance: &Instance) -> Result<()> {
    let dir = key_dir(instance);
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    if private_key(instance).is_file() && public_key(instance).is_file() {
        return Ok(());
    }
    let status = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-f"])
        .arg(private_key(instance))
        .status()
        .context("running ssh-keygen for the SDK webhook relay")?;
    if !status.success() {
        bail!("ssh-keygen failed for the SDK webhook relay");
    }
    Ok(())
}

/// Start the host-side reverse tunnel, retrying until the relay container's
/// `sshd` accepts the connection (see [`READY_TIMEOUT`]).
pub fn start(instance: &Instance) -> Result<Child> {
    ensure_keys(instance)?;
    stop(instance);
    let deadline = Instant::now() + READY_TIMEOUT;
    let mut last_err;
    loop {
        match try_start(instance) {
            Ok(child) => {
                std::fs::write(pid_path(instance), child.id().to_string())?;
                return Ok(child);
            }
            Err(e) => last_err = e,
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(RETRY_DELAY);
    }
    bail!(
        "SDK webhook SSH reverse tunnel did not come up within {}s: {last_err}",
        READY_TIMEOUT.as_secs()
    );
}

/// Start the tunnel, downgrading failure to a warning. Webhook delivery to
/// host receivers is a development convenience — losing it must not take the
/// whole stack down with it.
pub fn start_or_warn(stage: &Stage, instance: &Instance) -> Option<Child> {
    match start(instance) {
        Ok(child) => Some(child),
        Err(e) => {
            stage.note(&format!(
                "! SDK webhook tunnel unavailable — webhooks posted to {} will not reach \
                 host receivers on port {}. Everything else is up. ({e:#})",
                relay_url(),
                host_receiver_port(instance)
            ));
            None
        }
    }
}

/// One connect attempt. `Err` carries ssh's own diagnosis so a persistent
/// failure (bad key, port taken in the relay) is legible instead of a bare
/// exit status.
fn try_start(instance: &Instance) -> std::result::Result<Child, String> {
    let mut child = Command::new("ssh")
        .args([
            "-N",
            "-T",
            // Ignore the developer's ~/.ssh/config (and, per `-F`, the
            // system-wide one): everything this connection needs is specified
            // below, and inheriting personal config only imports failure. The
            // common one on macOS is the Apple keychain stanza — `UseKeychain`
            // is an Apple-only extension that the nix dev shell's upstream
            // OpenSSH rejects outright ("bad configuration options"), so ssh
            // exits 255 before it ever dials the relay.
            "-F",
            "/dev/null",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=/dev/null",
            "-o",
            "ConnectTimeout=2",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
            "-i",
        ])
        .arg(private_key(instance))
        .args(["-p"])
        .arg(ssh_port(instance).to_string())
        .args([
            "-R",
            &format!(
                "0.0.0.0:{RELAY_PORT}:127.0.0.1:{}",
                host_receiver_port(instance)
            ),
        ])
        .arg(format!("{USER}@127.0.0.1"))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawning ssh: {e}"))?;

    std::thread::sleep(SETTLE);
    match child.try_wait() {
        Ok(Some(status)) => {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            // ssh prints the definitive reason last ("Connection closed by
            // 127.0.0.1 port N"), preceded by lower-level noise.
            let reason = stderr
                .lines()
                .map(str::trim)
                .rfind(|l| !l.is_empty())
                .unwrap_or("no stderr output");
            Err(format!("ssh exited with {status}: {reason}"))
        }
        // Still alive: the tunnel is up. Drain stderr in the background so a
        // chatty ssh can never fill the pipe buffer and wedge the tunnel.
        Ok(None) => {
            if let Some(mut pipe) = child.stderr.take() {
                std::thread::spawn(move || {
                    let _ = std::io::copy(&mut pipe, &mut std::io::sink());
                });
            }
            Ok(child)
        }
        Err(e) => Err(format!("waiting on ssh: {e}")),
    }
}

/// Stop a previously started host-side tunnel, if present.
pub fn stop(instance: &Instance) {
    let path = pid_path(instance);
    let Some(pid) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|p| p.trim().parse::<i32>().ok())
    else {
        return;
    };
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
    let _ = std::fs::remove_file(path);
}
