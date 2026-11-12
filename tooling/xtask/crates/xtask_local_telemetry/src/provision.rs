//! Writing the settings file when it doesn't exist, so telemetry works by default.
//!
//! Runs on the sender thread, never on the caller's: the token comes from the
//! developer's own `doppler login` (see [`Provision::doppler`]) and is written
//! only to the settings file, mode 0600. A failed attempt (offline, logged out,
//! no access) is remembered for [`RETRY_AFTER`]; until then runs record nothing
//! and try nothing, and the next run prints one hint, once.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use super::config::{Config, Paths, Provision, Setting, Switch};
use super::unix_ns;

#[cfg(test)]
mod test;

const STATE_FILE: &str = "provision.json";
/// How long a failed attempt keeps later runs from recording and retrying.
pub(crate) const RETRY_AFTER: Duration = Duration::from_secs(3600);
/// The ingest token is random and at least this long, as CI checks.
const MIN_TOKEN_LEN: usize = 32;

/// The last attempt, beside the buffer.
#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    at_unix: u64,
    ok: bool,
    /// Whether a run has shown the hint since attempts started failing.
    hinted: bool,
}

fn read_state(buffer_dir: &Path) -> Option<State> {
    let text = std::fs::read_to_string(buffer_dir.join(STATE_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_state(buffer_dir: &Path, state: &State) {
    if let Ok(text) = serde_json::to_string(state) {
        let _ = std::fs::create_dir_all(buffer_dir);
        let _ = std::fs::write(buffer_dir.join(STATE_FILE), text);
    }
}

fn now_unix() -> u64 {
    unix_ns(SystemTime::now()) / 1_000_000_000
}

/// Whether an attempt failed within [`RETRY_AFTER`].
pub(crate) fn backing_off(buffer_dir: &Path) -> bool {
    read_state(buffer_dir).is_some_and(|state| {
        !state.ok && now_unix().saturating_sub(state.at_unix) < RETRY_AFTER.as_secs()
    })
}

fn note(buffer_dir: &Path, ok: bool) {
    let hinted = !ok && read_state(buffer_dir).is_some_and(|state| state.hinted);
    write_state(
        buffer_dir,
        &State {
            at_unix: now_unix(),
            ok,
            hinted,
        },
    );
}

/// Fetch a token and write the settings file, then load it. An existing file
/// wins unless `replace` is set, which provisioning uses only for a file it
/// wrote itself whose token was rejected.
pub(crate) fn provision(paths: &Paths, source: &Provision, replace: bool) -> Option<Config> {
    if backing_off(&paths.buffer_dir) {
        return None;
    }
    let written = fetch_token(source)
        .and_then(|token| write_settings(&paths.config, &source.endpoint, &token, replace).ok());
    let config = written.and_then(|()| match Config::load(&paths.config) {
        Ok(Setting::On(config)) => Some(config),
        _ => None,
    });
    // A file another run wrote while this one fetched still counts.
    let config = config.or_else(|| match Config::load(&paths.config) {
        Ok(Setting::On(config)) if !replace => Some(config),
        _ => None,
    });
    note(&paths.buffer_dir, config.is_some());
    config
}

fn fetch_token(source: &Provision) -> Option<String> {
    let (program, args) = source.command.split_first()?;
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let token = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    token_is_valid(&token).then_some(token)
}

/// Long enough to be the real token, and plain enough to sit in TOML and a header.
pub(crate) fn token_is_valid(token: &str) -> bool {
    token.len() >= MIN_TOKEN_LEN
        && token
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\\')
}

fn write_settings(path: &Path, endpoint: &str, token: &str, replace: bool) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = format!(
        "# Written by `just run_local` from Doppler (observability/lcl).\n\
         # `enabled = false` turns local telemetry off: docs/development/running-locally.md\n\
         endpoint = {}\n\
         token = {}\n\
         provisioned = true\n",
        toml::Value::from(endpoint),
        toml::Value::from(token),
    );
    let staging = path.with_extension(format!("toml.{}.new", std::process::id()));
    let result = (|| {
        let mut file = std::fs::File::options()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&staging)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        if replace {
            std::fs::rename(&staging, path)
        } else {
            // Fails if the file appeared meanwhile, so a user's file is never replaced.
            std::fs::hard_link(&staging, path)
        }
    })();
    let _ = std::fs::remove_file(&staging);
    result
}

/// The one-line hint for a run that records nothing because provisioning failed,
/// at most once until an attempt succeeds. `None` when opted out or already shown.
pub fn take_hint(paths: &Paths) -> Option<String> {
    if paths.switch == Switch::Off || paths.provision.is_none() || paths.config.exists() {
        return None;
    }
    let mut state = read_state(&paths.buffer_dir)?;
    if state.ok || state.hinted {
        return None;
    }
    state.hinted = true;
    write_state(&paths.buffer_dir, &state);
    Some(format!(
        "local telemetry: no token yet (Doppler observability/lcl LOCAL_TELEMETRY_TOKEN; \
         `doppler login` and retried hourly). `{}=off` turns it off.",
        super::config::SWITCH_VAR
    ))
}
