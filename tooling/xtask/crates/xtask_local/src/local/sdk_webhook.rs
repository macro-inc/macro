//! Instance-local relay for SDK webhook receivers running on the host.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::{Context, Result, bail};

use super::instance::{Instance, Port};

#[cfg(test)]
mod test;

const RELAY_PORT: u16 = 8787;
const USER: &str = "sdk-webhook";
const START_ATTEMPTS: u8 = 10;
const START_INTERVAL: Duration = Duration::from_millis(300);

fn ssh_client_flags(private_key: &Path, ssh_port: u16, host_receiver_port: u16) -> Vec<String> {
    vec![
        "-N".into(),
        "-T".into(),
        "-F".into(),
        "/dev/null".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "IdentitiesOnly=yes".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=no".into(),
        "-o".into(),
        "UserKnownHostsFile=/dev/null".into(),
        "-o".into(),
        "ConnectTimeout=2".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
        "-i".into(),
        private_key.display().to_string(),
        "-p".into(),
        ssh_port.to_string(),
        "-R".into(),
        format!("0.0.0.0:{RELAY_PORT}:127.0.0.1:{host_receiver_port}"),
        format!("{USER}@127.0.0.1"),
    ]
}

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
    let mut command = Command::new("ssh");
    command.args(ssh_client_flags(
        &private_key(instance),
        ssh_port(instance),
        host_receiver_port(instance),
    ));
    start_tunnel(instance, &mut command)
}

fn start_tunnel(instance: &Instance, command: &mut Command) -> Result<Child> {
    // Keep replacement and PID publication together: concurrent starts must
    // not both see an absent PID file and compete for the same remote port.
    let lock = std::fs::File::create(key_dir(instance).join("tunnel.lock"))?;
    lock.lock().context("locking SDK webhook tunnel startup")?;
    stop(instance);

    for attempt in 1..=START_ATTEMPTS {
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("starting the SDK webhook SSH reverse tunnel")?;

        std::thread::sleep(START_INTERVAL);
        let Some(status) = child.try_wait()? else {
            if let Err(error) = std::fs::write(pid_path(instance), child.id().to_string()) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error).context("recording the SDK webhook tunnel PID");
            }
            return Ok(child);
        };
        let mut err = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut err);
        }
        let err = err.trim();
        // The previous SSH connection can take a moment to release its remote
        // listener after SIGTERM. The relay itself may also still be starting.
        if attempt < START_ATTEMPTS
            && (err.contains("remote port forwarding failed")
                || err.contains("Connection refused")
                || err.contains("Connection reset by peer"))
        {
            continue;
        }
        if err.is_empty() {
            bail!("SDK webhook SSH reverse tunnel exited with {status}");
        }
        bail!("SDK webhook SSH reverse tunnel exited with {status}: {err}");
    }
    unreachable!("the final attempt returns either the tunnel or its error")
}

/// Stop a previously started host-side tunnel, if present.
pub fn stop(instance: &Instance) {
    let path = pid_path(instance);
    if let Some(pid) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|p| p.trim().parse::<i32>().ok())
        .filter(|pid| *pid > 0)
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }
    let _ = std::fs::remove_file(path);
}
