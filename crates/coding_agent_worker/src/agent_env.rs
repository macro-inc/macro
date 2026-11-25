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

/// Where the guest installs the staged environment; the agent reads it.
pub const AGENT_ENV_INSTALLED: &str = "/var/lib/macrod/agent.env";

/// What staging an environment did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Staged {
    /// Written to the inbox for the guest to install.
    Written,
    /// The agent already runs with exactly this environment (a hand-off sent
    /// again): nothing was written, so the guest doesn't restart the agent.
    Unchanged,
}

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
    installed: &Path,
    environment: &BTreeMap<String, String>,
) -> rootcause::Result<Staged> {
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
        .context("the agent environment names an invalid variable")?;
    let env = AgentEnv::new(values).context("the agent environment has an invalid value")?;
    let contents = env_file(&env);
    let current = std::fs::read_to_string(installed)
        .ok()
        .map(zeroize::Zeroizing::new);
    if current.as_deref().map(String::as_str) == Some(contents.as_str()) {
        return Ok(Staged::Unchanged);
    }
    let staging = path.with_extension("partial");
    write_private(&staging, &contents)?;
    std::fs::rename(&staging, path).context(format!("could not stage {}", path.display()))?;
    Ok(Staged::Written)
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
fn env_file(env: &hosted_runtimes::domain::agent::AgentEnv) -> zeroize::Zeroizing<String> {
    let mut contents = zeroize::Zeroizing::new(String::new());
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
