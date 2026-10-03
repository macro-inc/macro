//! Machine-specific leaf certificates signed by the stable development CA.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, ensure};

use super::{instance::Instance, repo_root};

/// Ask the host OS for the name used by Vite and the development certificate.
pub fn hostname() -> Result<String> {
    let output = Command::new("hostname")
        .output()
        .context("running hostname")?;
    ensure!(output.status.success(), "hostname command failed");
    let hostname = String::from_utf8(output.stdout)?
        .trim()
        .to_ascii_lowercase();
    ensure!(
        !hostname.is_empty()
            && hostname
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.'),
        "hostname is not a valid DNS name: {hostname}"
    );
    Ok(hostname)
}

/// Untracked, per-instance server key and certificate directory.
pub fn certs_dir(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join("proxy/certs")
}

/// Issue a leaf for this machine, keeping the checked-in CA unchanged.
pub fn issue(instance: &Instance) -> Result<()> {
    let output = Command::new("bash")
        .arg(repo_root().join("infra/local/certs/issue-host.sh"))
        .arg(certs_dir(instance))
        .arg(hostname()?)
        .output()
        .context("issuing local HTTPS certificate")?;
    ensure!(
        output.status.success(),
        "issuing local HTTPS certificate: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[cfg(test)]
mod test;
