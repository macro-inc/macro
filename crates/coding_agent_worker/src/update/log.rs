//! The persistent update log: one JSON line per self-update event in
//! `~/.macrod/logs/update.log`, so an operator can confirm what the updater
//! did after the panel that showed it has restarted. Versions, sizes and
//! outcomes only: never tokens, prompts, or agent output.

use std::io::Write as _;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        pub struct Home;
    }
    #[cfg(windows)]
    macro_env_var::maybe_env_var! {
        pub struct Userprofile;
    }
}

/// The log rotates to `update.log.1` (replacing an older one) at this size.
const MAX_BYTES: u64 = 1024 * 1024;

/// What a check found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckOutcome {
    UpToDate,
    Newer,
    NoAsset,
    UnrecognizedTag,
    Failed,
}

/// How a new version was put into use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApplyMethod {
    /// Unix: `execve` into the new binary, handing over the running agent.
    ExecveHandoff,
    /// Unix: `execve` into the new binary, but the agent could not be handed
    /// over and the new image starts a fresh one.
    FreshAgentFallback,
    /// Windows: installed beside the running version, used from the next
    /// launch.
    #[cfg_attr(
        not(windows),
        expect(dead_code, reason = "only Windows installs for the next launch")
    )]
    NextLaunch,
}

/// One line of the log.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum UpdateEvent {
    /// The control panel started.
    Startup { version: String, from_handoff: bool },
    Check {
        current: String,
        latest: Option<String>,
        outcome: CheckOutcome,
    },
    Download {
        version: String,
        bytes: u64,
        checksum_ok: bool,
        result: String,
    },
    Apply {
        /// `None` when the new image reports it and the old version is gone.
        from: Option<String>,
        to: String,
        method: ApplyMethod,
        active_prompts: usize,
        result: String,
    },
}

#[derive(serde::Serialize)]
struct Line<'a> {
    time: String,
    #[serde(flatten)]
    event: &'a UpdateEvent,
}

/// An update log file.
pub struct UpdateLog {
    path: PathBuf,
    max_bytes: u64,
}

impl UpdateLog {
    /// `~/.macrod/logs/update.log` (`%USERPROFILE%` on Windows), when the
    /// home directory is known.
    pub fn for_user() -> Option<Self> {
        let home = environment::Home::new().and_then(|home| home.value().map(PathBuf::from));
        #[cfg(windows)]
        let home = home.or_else(|| {
            environment::Userprofile::new().and_then(|home| home.value().map(PathBuf::from))
        });
        Some(Self::at(
            home?.join(".macrod").join("logs").join("update.log"),
            MAX_BYTES,
        ))
    }

    fn at(path: PathBuf, max_bytes: u64) -> Self {
        Self { path, max_bytes }
    }

    /// Append `event`. Best effort: a log that cannot be written is reported
    /// in the panel's logs and never stops an update.
    pub fn record(&self, event: &UpdateEvent) {
        if let Err(error) = self.append(event) {
            tracing::warn!(error = %error, path = %self.path.display(), "could not write the update log");
        }
    }

    fn append(&self, event: &UpdateEvent) -> std::io::Result<()> {
        let directory = self.path.parent().unwrap_or(Path::new("."));
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt as _;
            builder.mode(0o700);
        }
        builder.create(directory)?;
        if std::fs::metadata(&self.path).is_ok_and(|metadata| metadata.len() >= self.max_bytes) {
            let mut rotated = self.path.clone().into_os_string();
            rotated.push(".1");
            std::fs::rename(&self.path, rotated)?;
        }
        let mut line = serde_json::to_vec(&Line {
            time: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            event,
        })
        .map_err(std::io::Error::other)?;
        line.push(b'\n');
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        // One write per line, so concurrent writers interleave whole lines.
        options.open(&self.path)?.write_all(&line)
    }
}

/// Append `event` to the user's update log.
pub fn record(event: UpdateEvent) {
    if let Some(log) = UpdateLog::for_user() {
        log.record(&event);
    }
}

/// Where the user's update log is, for the panel to point at.
pub fn user_log_path() -> Option<PathBuf> {
    UpdateLog::for_user().map(|log| log.path)
}
