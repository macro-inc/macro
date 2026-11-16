//! Running Claude Code processes, from its session registry:
//! `<claude>/sessions/<pid>.json`. Only those files are read; the key files
//! beside them are never opened.

#[cfg(test)]
mod test;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use chrono::DateTime;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::SourceKind;
use crate::domain::observation::{ClaudeSessionFact, Fact, Observation};
use crate::domain::source::{AgentSource, SourceError};
use crate::outbound::records::{self, Fingerprint, RecordFormat, WatchedDir, stat};

const RECORD_EXTENSION: &str = "json";

/// Reads the Claude Code session registry.
#[derive(Clone, Debug)]
pub struct ClaudeRegistrySource {
    sessions: PathBuf,
}

impl ClaudeRegistrySource {
    /// Watches `sessions` (Claude Code's `~/.claude/sessions`).
    pub fn new(sessions: PathBuf) -> Self {
        Self { sessions }
    }
}

#[async_trait]
impl AgentSource for ClaudeRegistrySource {
    fn kind(&self) -> SourceKind {
        SourceKind::ClaudeRegistry
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        records::run(*self, out, cancel).await
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    pid: u32,
    session_id: String,
    cwd: Option<PathBuf>,
    name: Option<String>,
    status: Option<String>,
    updated_at: Option<i64>,
}

impl ClaudeRegistrySource {
    /// The pid a registry file is named for, if `path` is a registry file.
    fn pid_of(&self, path: &Path) -> Option<u32> {
        if path.parent()? != self.sessions {
            return None;
        }
        let name = path.file_name()?.to_str()?;
        let (stem, extension) = name.split_once('.')?;
        if extension != RECORD_EXTENSION {
            return None;
        }
        stem.parse().ok()
    }
}

impl RecordFormat for ClaudeRegistrySource {
    const SOURCE: SourceKind = SourceKind::ClaudeRegistry;

    fn watched(&self) -> Vec<WatchedDir> {
        vec![WatchedDir {
            path: self.sessions.clone(),
            recursive: false,
        }]
    }

    fn list(&self) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(&self.sessions) else {
            return Vec::new();
        };
        entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| self.pid_of(path).is_some())
            .collect()
    }

    fn record_of(&self, changed: &Path) -> Option<PathBuf> {
        self.pid_of(changed).map(|_| changed.to_owned())
    }

    fn fingerprint(&self, record: &Path) -> Option<Fingerprint> {
        let file = stat(record);
        if !file.2 {
            return None;
        }
        let alive = self.pid_of(record).is_some_and(is_alive);
        Some(vec![file, (0, None, alive)])
    }

    fn read(&self, record: &Path) -> Option<Fact> {
        let pid = self.pid_of(record)?;
        // A process that died without removing its entry is not running.
        if !is_alive(pid) {
            return None;
        }
        let text = std::fs::read(record).ok()?;
        let entry: Entry = serde_json::from_slice(&text).ok()?;
        if entry.pid != pid {
            return None;
        }
        Some(Fact::ClaudeSession(ClaudeSessionFact {
            pid: entry.pid,
            session_id: entry.session_id,
            cwd: entry.cwd,
            name: entry.name.filter(|name| !name.is_empty()),
            busy: entry.status.as_deref() == Some("busy"),
            updated: entry.updated_at.and_then(DateTime::from_timestamp_millis),
        }))
    }
}

/// Whether a process is running. Without `/proc` (macOS), every entry is
/// taken as running: Claude Code removes its entry when it exits.
fn is_alive(pid: u32) -> bool {
    let proc = Path::new("/proc");
    !proc.is_dir() || proc.join(pid.to_string()).exists()
}
