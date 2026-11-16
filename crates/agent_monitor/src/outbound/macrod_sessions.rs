//! Sessions macrod dispatched, from its session records:
//! `<macrod>/herdr/<harness>/sessions/<id>.json`.

#[cfg(test)]
mod test;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use chrono::DateTime;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::SourceKind;
use crate::domain::observation::{Fact, MacrodSessionFact, Observation};
use crate::domain::source::{AgentSource, SourceError};
use crate::outbound::records::{self, Fingerprint, RecordFormat, WatchedDir, stat};

const SESSIONS_DIR: &str = "sessions";
const RECORD_EXTENSION: &str = "json";

/// Reads macrod's session records.
#[derive(Clone, Debug)]
pub struct MacrodSessionsSource {
    harnesses: PathBuf,
}

impl MacrodSessionsSource {
    /// Watches `harnesses` (macrod's `<home>/herdr`), one directory per
    /// harness, each with a `sessions` directory.
    pub fn new(harnesses: PathBuf) -> Self {
        Self { harnesses }
    }

    fn session_dirs(&self) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(&self.harnesses) else {
            return Vec::new();
        };
        entries
            .flatten()
            .map(|entry| entry.path().join(SESSIONS_DIR))
            .filter(|dir| dir.is_dir())
            .collect()
    }

    /// The harness a record belongs to, if `path` is a session record.
    fn harness_of(&self, path: &Path) -> Option<String> {
        if path.extension()? != RECORD_EXTENSION {
            return None;
        }
        let sessions = path.parent()?;
        if sessions.file_name()? != SESSIONS_DIR {
            return None;
        }
        let harness = sessions.parent()?;
        if harness.parent()? != self.harnesses {
            return None;
        }
        harness.file_name()?.to_str().map(str::to_owned)
    }
}

#[async_trait]
impl AgentSource for MacrodSessionsSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Macrod
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
struct Record {
    id: String,
    cwd: Option<PathBuf>,
    model: Option<String>,
    native_id: Option<String>,
    transcript: Option<PathBuf>,
    /// Unix seconds.
    started: Option<i64>,
}

impl RecordFormat for MacrodSessionsSource {
    const SOURCE: SourceKind = SourceKind::Macrod;

    fn watched(&self) -> Vec<WatchedDir> {
        // The harness directory itself, so a new harness is noticed, and each
        // harness's sessions directory. Never the harness directories
        // recursively: they hold whole worktrees.
        let mut watched = vec![WatchedDir {
            path: self.harnesses.clone(),
            recursive: false,
        }];
        watched.extend(self.session_dirs().into_iter().map(|path| WatchedDir {
            path,
            recursive: false,
        }));
        watched
    }

    fn list(&self) -> Vec<PathBuf> {
        self.session_dirs()
            .into_iter()
            .filter_map(|dir| std::fs::read_dir(dir).ok())
            .flat_map(|entries| entries.flatten().map(|entry| entry.path()))
            .filter(|path| self.harness_of(path).is_some())
            .collect()
    }

    fn record_of(&self, changed: &Path) -> Option<PathBuf> {
        self.harness_of(changed).map(|_| changed.to_owned())
    }

    fn fingerprint(&self, record: &Path) -> Option<Fingerprint> {
        let file = stat(record);
        file.2.then(|| vec![file])
    }

    fn read(&self, record: &Path) -> Option<Fact> {
        let harness = self.harness_of(record)?;
        let text = std::fs::read(record).ok()?;
        let record: Record = serde_json::from_slice(&text).ok()?;
        Some(Fact::MacrodSession(MacrodSessionFact {
            id: record.id,
            harness,
            cwd: record.cwd,
            model: record.model,
            native_id: record.native_id,
            transcript: record.transcript,
            started: record
                .started
                .and_then(|seconds| DateTime::from_timestamp(seconds, 0)),
        }))
    }
}
