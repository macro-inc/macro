//! Writing the settings file when it doesn't exist, so telemetry works by default.
//!
//! Runs on the sender thread, never on the caller's: the token comes from the
//! developer's own `doppler login` (see [`Provision::doppler`]) and is written
//! only to the settings file, mode 0600. The command writes into a 0600 file of
//! its own, so a short command that exits first doesn't lose the fetch: the next
//! run reads it. A failed attempt (offline, logged out, no access) is remembered
//! for [`RETRY_AFTER`]; until then runs record nothing and try nothing, and the
//! next run prints one hint, once.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use super::config::{Config, Paths, Provision, Setting, Switch};
use super::unix_ns;

#[cfg(test)]
mod test;

const STATE_FILE: &str = "provision.json";
/// How long a failed (or unfinished) attempt keeps later runs from recording
/// and retrying.
pub(crate) const RETRY_AFTER: Duration = Duration::from_secs(3600);
/// How long the token command may run before it is killed. Doppler's own
/// `--timeout` covers its HTTP request, not a stuck keyring or DNS lookup.
const FETCH_DEADLINE: Duration = Duration::from_secs(15);
/// The ingest token is random and at least this long, as CI checks.
const MIN_TOKEN_LEN: usize = 32;
const STAGING_SUFFIX: &str = ".new";
/// A token command's output, kept while it runs.
const TOKEN_SUFFIX: &str = ".token";
/// Staging files older than this were left by a killed process.
const STALE_STAGING: Duration = Duration::from_secs(3600);

/// The last attempt, beside the buffer.
#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    at_unix: u64,
    ok: bool,
    /// An attempt started and hasn't finished (or its process was killed).
    #[serde(default)]
    pending: bool,
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

/// Whether an attempt failed within [`RETRY_AFTER`], or one is in flight
/// (started within [`FETCH_DEADLINE`]).
pub(crate) fn backing_off(buffer_dir: &Path) -> bool {
    read_state(buffer_dir).is_some_and(|state| {
        let window = if state.pending {
            FETCH_DEADLINE
        } else {
            RETRY_AFTER
        };
        !state.ok && now_unix().saturating_sub(state.at_unix) < window.as_secs()
    })
}

fn note(buffer_dir: &Path, ok: bool, pending: bool) {
    let hinted = !ok && read_state(buffer_dir).is_some_and(|state| state.hinted);
    write_state(
        buffer_dir,
        &State {
            at_unix: now_unix(),
            ok,
            pending,
            hinted,
        },
    );
}

fn load_on(path: &Path) -> Option<Config> {
    match Config::load(path) {
        Ok(Setting::On(config)) => Some(config),
        _ => None,
    }
}

/// Fetch a token and write the settings file, then load it.
///
/// With `rejected` unset, an existing file always wins and is never replaced.
/// With it set (the endpoint refused that provisioned config's token), the file
/// is replaced only while it still holds exactly that provisioned config, so a
/// file the user has since edited or swapped is left alone.
pub(crate) fn provision(
    paths: &Paths,
    source: &Provision,
    rejected: Option<&Config>,
) -> Option<Config> {
    if rejected.is_none() && paths.config.exists() {
        // Another run, or the user, wrote it after this run started.
        return load_on(&paths.config);
    }
    if backing_off(&paths.buffer_dir) {
        return None;
    }
    let token = match finished_fetch(&paths.config) {
        Fetch::Token(token) => Some(token),
        Fetch::Failed => None,
        Fetch::InFlight => return None,
        Fetch::None => {
            // Claims the attempt, so concurrent runs wait for it instead of
            // fetching too.
            note(&paths.buffer_dir, false, true);
            fetch_token(source, &paths.config)
        }
    };
    let fetched = match token {
        // The same token again can't fix a rejection: back off instead of
        // fetching on every run.
        Some(token) if rejected.is_none_or(|old| !old.has_token(&token)) => Fetched::Token(token),
        Some(_) => Fetched::Failed,
        // This process exits before the command does: a later run reads its file.
        None if fetch_left_running(&paths.config) => Fetched::Running,
        None => Fetched::Failed,
    };
    let token = match fetched {
        Fetched::Token(token) => token,
        Fetched::Running => return None,
        Fetched::Failed => {
            note(&paths.buffer_dir, false, false);
            return None;
        }
    };
    if let Some(old) = rejected {
        let unchanged = load_on(&paths.config)
            .is_some_and(|current| current.provisioned() && current.same_as(old));
        if !unchanged {
            note(&paths.buffer_dir, false, false);
            return None;
        }
    }
    let config = match write_settings(&paths.config, &source.endpoint, &token, rejected) {
        Ok(()) => load_on(&paths.config),
        // Another run linked its file first; it is just as good.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => load_on(&paths.config),
        Err(_) => None,
    };
    note(&paths.buffer_dir, config.is_some(), false);
    config
}

enum Fetch {
    /// An earlier process's command finished with a token.
    Token(String),
    /// An earlier process's command finished without one.
    Failed,
    /// An earlier process's command may still be running.
    InFlight,
    /// No earlier command: start one.
    None,
}

enum Fetched {
    Token(String),
    Running,
    Failed,
}

/// The token files of fetches that ended with their process still running.
fn fetch_files(config: &Path) -> Vec<PathBuf> {
    let (Some(dir), Some(name)) = (config.parent(), config.file_name()) else {
        return Vec::new();
    };
    let prefix = format!(".{}.", name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(TOKEN_SUFFIX))
        })
        .collect()
}

fn age(path: &Path) -> Duration {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .unwrap_or_default()
}

/// Read what an earlier process's token command wrote. The command writes the
/// token in one short write, so a file with a valid token is complete; an
/// invalid one past the deadline is a failed fetch.
fn finished_fetch(config: &Path) -> Fetch {
    let mut result = Fetch::None;
    for path in fetch_files(config) {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let token = text.trim();
        if token_is_valid(token) {
            let _ = std::fs::remove_file(&path);
            return Fetch::Token(token.to_owned());
        }
        if age(&path) > FETCH_DEADLINE {
            let _ = std::fs::remove_file(&path);
            if matches!(result, Fetch::None) {
                result = Fetch::Failed;
            }
        } else {
            result = Fetch::InFlight;
        }
    }
    result
}

fn fetch_left_running(config: &Path) -> bool {
    !fetch_files(config).is_empty()
}

/// Run the token command with its stdout in a 0600 file beside the settings,
/// killing it after [`FETCH_DEADLINE`]. If this process exits first, the
/// command still finishes and a later run reads the file ([`finished_fetch`]).
fn fetch_token(source: &Provision, config: &Path) -> Option<String> {
    let (program, args) = source.command.split_first()?;
    let dir = config.parent()?;
    std::fs::create_dir_all(dir).ok()?;
    let path = sibling(
        config,
        &uuid::Uuid::now_v7().simple().to_string(),
        TOKEN_SUFFIX,
    );
    let file = std::fs::File::options()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .ok()?;
    let spawned = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(file))
        .stderr(Stdio::null())
        // Its own process group, so a Ctrl-C to the run doesn't cut it short.
        .process_group(0)
        .spawn();
    let Ok(mut child) = spawned else {
        let _ = std::fs::remove_file(&path);
        return None;
    };
    let pid = child.id();
    let (sent, received) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sent.send(child.wait());
    });
    let status = match received.recv_timeout(FETCH_DEADLINE) {
        Ok(status) => status.ok(),
        Err(_) => {
            // The waiting thread owns the child; signal it by pid.
            // SAFETY: kill(2) with a pid we spawned and haven't reaped (the
            // waiter is still blocked), so it can't name another process.
            unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
            None
        }
    };
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    let token = text.trim().to_owned();
    (status?.success() && token_is_valid(&token)).then_some(token)
}

/// Long enough to be the real token, and plain enough to sit in TOML and a header.
pub(crate) fn token_is_valid(token: &str) -> bool {
    token.len() >= MIN_TOKEN_LEN
        && token
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\\')
}

/// Write the settings file. `replacing` is the provisioned config being
/// replaced: its `services` and `machine` choices carry over.
fn write_settings(
    path: &Path,
    endpoint: &str,
    token: &str,
    replacing: Option<&Config>,
) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    remove_stale_staging(path);
    let mut text = format!(
        "# Written by `just run_local` from Doppler (observability/lcl).\n\
         # Edit freely, but delete `provisioned = true` so it is never replaced.\n\
         # `enabled = false` turns local telemetry off, and `services = true` also\n\
         # sends your local stacks' traces, logs and metrics: docs/development/running-locally.md\n\
         endpoint = {}\n\
         token = {}\n\
         provisioned = true\n",
        toml::Value::from(endpoint),
        toml::Value::from(token),
    );
    if let Some(old) = replacing {
        if old.services() {
            text.push_str("services = true\n");
        }
        if let Some(machine) = old.machine() {
            text.push_str(&format!(
                "machine = {}\n",
                toml::Value::from(machine.as_str())
            ));
        }
    }
    let replace = replacing.is_some();
    // Unique per attempt: two senders in one process must not share it.
    let staging = sibling(
        path,
        &uuid::Uuid::now_v7().simple().to_string(),
        STAGING_SUFFIX,
    );
    let mut file = std::fs::File::options()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staging)?;
    let result = (|| {
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        if replace {
            return std::fs::rename(&staging, path);
        }
        // Fails if the file appeared meanwhile, so a user's file is never replaced.
        match std::fs::hard_link(&staging, path) {
            Err(error) if error.kind() != std::io::ErrorKind::AlreadyExists => {
                // A filesystem without hard links: check, then rename.
                if path.exists() {
                    Err(std::io::ErrorKind::AlreadyExists.into())
                } else {
                    std::fs::rename(&staging, path)
                }
            }
            other => other,
        }
    })();
    let _ = std::fs::remove_file(&staging);
    result
}

/// A hidden file beside the settings: `.local-telemetry.toml.<id><suffix>`.
fn sibling(path: &Path, id: &str, suffix: &str) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.{id}{suffix}"))
}

/// Delete staging files (each holding a token) that a killed process left.
fn remove_stale_staging(path: &Path) {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return;
    };
    let prefix = format!(".{}.", name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !(file_name.starts_with(&prefix) && file_name.ends_with(STAGING_SUFFIX)) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > STALE_STAGING);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The one-line hint for a run that records nothing because provisioning failed,
/// at most once until an attempt succeeds. `None` when opted out or already shown.
pub fn take_hint(paths: &Paths) -> Option<String> {
    if paths.switch == Switch::Off || paths.provision.is_none() || paths.config.exists() {
        return None;
    }
    let mut state = read_state(&paths.buffer_dir)?;
    if state.ok || state.pending || state.hinted {
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
