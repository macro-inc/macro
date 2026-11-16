//! Generic work-run records in configured directories: `<dir>/<id>.json`
//! (`{id, task, label, status, started, pid, herdr: {terminal}}`) with an
//! optional `<id>.cost` beside it holding the run's dollar cost. Nothing about
//! which directories exist is compiled in; they come from config.
//!
//! A finished run older than the history window is not reported.

#[cfg(test)]
mod test;

use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{Cost, SourceKind, Timestamp};
use crate::domain::observation::{Fact, Observation, RunRecordFact};
use crate::domain::source::{AgentSource, SourceError};
use crate::outbound::records::{self, Fingerprint, RecordFormat, WatchedDir, stat};

const RECORD_EXTENSION: &str = "json";
const COST_EXTENSION: &str = "cost";

/// The status word of a run still going.
const RUNNING: &str = "running";

/// Reads work-run records.
#[derive(Clone, Debug)]
pub struct RunRecordsSource {
    dirs: Vec<PathBuf>,
    history: Duration,
}

impl RunRecordsSource {
    /// Watches each of `dirs`; reports running runs, and finished ones that
    /// started within `history`.
    pub fn new(dirs: Vec<PathBuf>, history: Duration) -> Self {
        Self { dirs, history }
    }

    /// The run id `path` belongs to: `<dir>/<id>.json` or `<dir>/<id>.cost`
    /// in a configured directory, with no dot in the id.
    fn run_of(&self, path: &Path) -> Option<(PathBuf, String)> {
        let dir = path.parent()?;
        if !self.dirs.iter().any(|configured| configured == dir) {
            return None;
        }
        let name = path.file_name()?.to_str()?;
        let (id, extension) = name.split_once('.')?;
        let known = extension == RECORD_EXTENSION || extension == COST_EXTENSION;
        (known && !id.is_empty()).then(|| (dir.to_owned(), id.to_owned()))
    }
}

#[async_trait]
impl AgentSource for RunRecordsSource {
    fn kind(&self) -> SourceKind {
        SourceKind::RunRecord
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
    id: Option<String>,
    task: Option<String>,
    label: Option<String>,
    status: Option<String>,
    started: Option<Started>,
    pid: Option<u32>,
    herdr: Option<Herdr>,
    cost_usd: Option<f64>,
}

/// A start time as an RFC 3339 string or Unix milliseconds.
#[derive(Deserialize)]
#[serde(untagged)]
enum Started {
    Text(Timestamp),
    Millis(i64),
}

#[derive(Deserialize)]
struct Herdr {
    terminal: Option<String>,
}

impl RecordFormat for RunRecordsSource {
    const SOURCE: SourceKind = SourceKind::RunRecord;

    fn watched(&self) -> Vec<WatchedDir> {
        self.dirs
            .iter()
            .map(|path| WatchedDir {
                path: path.clone(),
                recursive: false,
            })
            .collect()
    }

    fn list(&self) -> Vec<PathBuf> {
        self.dirs
            .iter()
            .filter_map(|dir| std::fs::read_dir(dir).ok())
            .flat_map(|entries| entries.flatten().map(|entry| entry.path()))
            .filter(|path| {
                path.extension().is_some_and(|ext| ext == RECORD_EXTENSION)
                    && self.run_of(path).is_some()
            })
            .collect()
    }

    fn record_of(&self, changed: &Path) -> Option<PathBuf> {
        let (dir, id) = self.run_of(changed)?;
        Some(dir.join(format!("{id}.{RECORD_EXTENSION}")))
    }

    fn fingerprint(&self, record: &Path) -> Option<Fingerprint> {
        let file = stat(record);
        file.2
            .then(|| vec![file, stat(&record.with_extension(COST_EXTENSION))])
    }

    fn read(&self, record: &Path) -> Option<Fact> {
        let (_, file_id) = self.run_of(record)?;
        let text = std::fs::read(record).ok()?;
        let run: Record = serde_json::from_slice(&text).ok()?;
        let started = run.started.and_then(|started| match started {
            Started::Text(at) => Some(at),
            Started::Millis(millis) => DateTime::from_timestamp_millis(millis),
        });

        let running = run.status.as_deref() == Some(RUNNING);
        let horizon = Utc::now() - self.history;
        let recent = started.is_some_and(|started| started >= horizon);
        if !running && !recent {
            return None;
        }

        let cost = std::fs::read_to_string(record.with_extension(COST_EXTENSION))
            .ok()
            .and_then(|text| text.trim().parse::<f64>().ok())
            .or(run.cost_usd)
            .map(Cost::Known);
        Some(Fact::RunRecord(RunRecordFact {
            id: run.id.unwrap_or(file_id),
            task: run.task,
            label: run.label,
            status: run.status,
            started,
            pid: run.pid,
            terminal: run.herdr.and_then(|herdr| herdr.terminal),
            cost,
        }))
    }
}
