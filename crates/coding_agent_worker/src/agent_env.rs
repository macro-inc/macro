//! An agent teammate's environment, handed to a Macro computer's macrod over
//! its authenticated socket (`ToRuntimeMessage::ApplyAgent`) and staged for
//! the guest to install. Credentials never come through the enrollment.

use std::collections::BTreeMap;
use std::path::Path;

use rootcause::prelude::ResultExt as _;

#[cfg(test)]
mod test;

/// Where macrod stages the environment. macrod runs as `macro` and cannot
/// write `/var/lib/macrod`; the guest's root `macro-agent-apply` unit
/// installs the staged file as `/var/lib/macrod/agent.env`, only on a
/// computer restored as an agent's, and empties the inbox.
pub const AGENT_ENV_INBOX: &str = "/run/macro-agent-inbox/agent.env";

/// Where macrod stages the computer's setup trace for the agent's start
/// (`start-agent` reads it). Beside the environment, never in it: each
/// redelivery carries a fresh trace context, and a changed environment
/// restarts the agent.
pub const SETUP_TRACEPARENT_INBOX: &str = "/run/macro-agent-inbox/setup-traceparent";

/// Validate an environment from the wire and stage it at `path` (mode 0600),
/// written whole: it appears under its name only once complete, so the unit
/// that watches for it never installs a partial file. A re-sent environment
/// (a rotated key) replaces the staged one the same way. Refused when the
/// inbox directory is absent: only an agent computer's guest has one.
pub fn stage_agent_env(
    path: &Path,
    environment: &BTreeMap<String, String>,
) -> rootcause::Result<()> {
    use hosted_runtimes::domain::agent::{AgentEnv, AgentEnvKey, InvalidAgentEnvKey};

    let inbox = path
        .parent()
        .ok_or_else(|| rootcause::report!("{} has no directory", path.display()))?;
    if !inbox.is_dir() {
        rootcause::bail!("{} is absent: this computer runs no agent", inbox.display());
    }
    let values = environment
        .iter()
        .map(|(key, value)| Ok((AgentEnvKey::new(key.clone())?, value.clone())))
        .collect::<Result<BTreeMap<_, _>, InvalidAgentEnvKey>>()
        .map_err(|error| rootcause::report!("{error}"))?;
    let env = AgentEnv::new(values).map_err(|error| rootcause::report!("{error}"))?;
    let staging = path.with_extension("partial");
    write_private(&staging, &env_file(&env))?;
    std::fs::rename(&staging, path).context(format!("could not stage {}", path.display()))?;
    Ok(())
}

/// Stage the first valid setup `traceparent` at `path` for the agent's start;
/// a later one (a redelivery's) leaves it, and a malformed or absent one
/// stages nothing rather than failing the hand-off. Not a secret.
pub fn stage_setup_traceparent(path: &Path, traceparent: Option<&str>) -> rootcause::Result<()> {
    let Some(traceparent) = traceparent.filter(|traceparent| {
        hosted_runtimes::domain::telemetry::is_valid_traceparent(traceparent)
    }) else {
        return Ok(());
    };
    // Without the inbox the environment's staging refuses, with the reason.
    if path.exists() || !path.parent().is_some_and(Path::is_dir) {
        return Ok(());
    }
    let staging = path.with_extension("partial");
    write_private(&staging, traceparent)?;
    std::fs::rename(&staging, path).context(format!("could not stage {}", path.display()))?;
    Ok(())
}

/// `KEY="value"` lines, with `\` and `"` escaped as systemd expects. Names
/// and single-line values are validated by [`AgentEnv`].
///
/// [`AgentEnv`]: hosted_runtimes::domain::agent::AgentEnv
fn env_file(env: &hosted_runtimes::domain::agent::AgentEnv) -> String {
    let mut contents = String::new();
    for (key, value) in env.expose() {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        contents.push_str(&format!("{}=\"{escaped}\"\n", key.as_str()));
    }
    contents
}

fn write_private(path: &Path, contents: &str) -> rootcause::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .context(format!("could not open {}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .context(format!("could not set the mode of {}", path.display()))?;
    file.write_all(contents.as_bytes())
        .context(format!("could not write {}", path.display()))?;
    Ok(())
}
