//! Local stopgap until a provisioner creates team namespaces: give every
//! existing team its Passwords namespace in the instance's OpenBao. Creating a
//! team does not create one, so a team made later needs `just
//! passwords_provision` (or a stack restart). Reuses the idempotent
//! `infra/local/openbao/bootstrap.py`, which never deletes values.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

use super::instance::{Instance, Port};
use super::local_env::PASSWORDS_JWT_ISSUER;
use super::repo_root;
use super::stage::Stage;

/// `start.sh` writes the bootstrap credentials once initialization finishes.
const BOOTSTRAP_WAIT: Duration = Duration::from_secs(90);

/// Provision a namespace for every team in the instance database.
pub fn provision_teams(stage: &Stage, instance: &Instance) -> Result<()> {
    let teams = team_ids(&container_output(
        instance,
        "postgres",
        &[
            "psql",
            "-U",
            "user",
            "-d",
            "macrodb",
            "-tAc",
            "SELECT id FROM team ORDER BY id",
        ],
    )?)?;
    if teams.is_empty() {
        stage.note("  no teams yet: no team vaults to provision");
        return Ok(());
    }
    let init_file = copy_bootstrap_credentials(instance)?;
    let mut bootstrap = Command::new("python3");
    bootstrap.args(bootstrap_args(instance, &init_file, &teams));
    stage.run(
        &format!("Provisioning {} team vault(s)", teams.len()),
        &mut bootstrap,
    )
}

/// Team ids from `psql -tA` output, one per line.
fn team_ids(output: &str) -> Result<Vec<uuid::Uuid>> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| uuid::Uuid::parse_str(line.trim()).context("reading a team id"))
        .collect()
}

fn bootstrap_args(instance: &Instance, init_file: &Path, teams: &[uuid::Uuid]) -> Vec<String> {
    let mut args = vec![
        repo_root()
            .join("infra/local/openbao/bootstrap.py")
            .display()
            .to_string(),
        "--init-file".into(),
        init_file.display().to_string(),
        "--address".into(),
        format!("http://127.0.0.1:{}", instance.port(Port::OpenBao)),
        "--jwt-public-key".into(),
        instance
            .artifact_dir()
            .join("passwords-jwt.public.pem")
            .display()
            .to_string(),
        "--jwt-issuer".into(),
        PASSWORDS_JWT_ISSUER.into(),
    ];
    for team in teams {
        args.extend(["--team-id".into(), team.to_string()]);
    }
    args
}

/// Copy the root bootstrap credentials into the ignored instance directory,
/// mode 0600, as the README's manual procedure does. Never printed.
fn copy_bootstrap_credentials(instance: &Instance) -> Result<PathBuf> {
    let started = Instant::now();
    let credentials = loop {
        match container_output(
            instance,
            "openbao",
            &["cat", "/openbao/file/bootstrap.json"],
        ) {
            Ok(credentials) => break credentials,
            Err(error) if started.elapsed() > BOOTSTRAP_WAIT => {
                return Err(error.context("waiting for OpenBao to initialize"));
            }
            Err(_) => std::thread::sleep(Duration::from_secs(2)),
        }
    };
    let path = instance
        .ensure_artifact_dir()?
        .join("openbao-bootstrap.json");
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&path)
        .and_then(|mut file| file.write_all(credentials.as_bytes()))
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

/// Stdout of `command` in the instance's `service` container. Stderr is
/// dropped: it never carries what we need and must not reach the terminal.
fn container_output(instance: &Instance, service: &str, command: &[&str]) -> Result<String> {
    let container = format!("{}-{service}-1", instance.project_name());
    let output = Command::new("docker")
        .arg("exec")
        .arg(&container)
        .args(command)
        .stderr(std::process::Stdio::null())
        .output()
        .with_context(|| format!("running docker exec in {container}"))?;
    if !output.status.success() {
        bail!("docker exec in {container} failed ({})", output.status);
    }
    String::from_utf8(output.stdout).with_context(|| format!("reading output from {container}"))
}

#[cfg(test)]
mod test;
