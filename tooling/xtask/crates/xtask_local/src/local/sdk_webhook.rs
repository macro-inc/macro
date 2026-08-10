//! Instance-local relay for SDK webhook receivers running on the host.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::{Context, Result, bail};

use super::instance::{Instance, Port};

const RELAY_PORT: u16 = 8787;
const USER: &str = "sdk-webhook";

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

/// Start the host-side reverse tunnel after the relay container is running.
pub fn start(instance: &Instance) -> Result<Child> {
    ensure_keys(instance)?;
    stop(instance);
    let mut child = Command::new("ssh")
        .args([
            "-N",
            "-T",
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
        .stderr(Stdio::null())
        .spawn()
        .context("starting the SDK webhook SSH reverse tunnel")?;

    std::thread::sleep(Duration::from_millis(300));
    if let Some(status) = child.try_wait()? {
        bail!("SDK webhook SSH reverse tunnel exited with {status}");
    }
    std::fs::write(pid_path(instance), child.id().to_string())?;
    Ok(child)
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
