//! herdr manager directories: `<managers>/<terminal>-<started ms>/` with
//! `goal.md`, a `state` word, and review verdicts in `reviews/<n>.verdict`
//! (first line `pass` or `fail`).

#[cfg(test)]
mod test;

use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::SourceKind;
use crate::domain::observation::{Fact, ManagerFact, Observation};
use crate::domain::source::{AgentSource, SourceError};
use crate::outbound::records::{self, Fingerprint, RecordFormat, WatchedDir, stat};

const GOAL_FILE: &str = "goal.md";
const STATE_FILE: &str = "state";
const REVIEWS_DIR: &str = "reviews";
const VERDICT_EXTENSION: &str = "verdict";

/// Reads herdr manager directories.
#[derive(Clone, Debug)]
pub struct ManagersSource {
    managers: PathBuf,
}

impl ManagersSource {
    /// Watches `managers` (herdr's `~/.herdr/managers`).
    pub fn new(managers: PathBuf) -> Self {
        Self { managers }
    }
}

#[async_trait]
impl AgentSource for ManagersSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Manager
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        records::run(*self, out, cancel).await
    }
}

impl RecordFormat for ManagersSource {
    const SOURCE: SourceKind = SourceKind::Manager;

    fn watched(&self) -> Vec<WatchedDir> {
        vec![WatchedDir {
            path: self.managers.clone(),
            recursive: true,
        }]
    }

    fn list(&self) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(&self.managers) else {
            return Vec::new();
        };
        entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect()
    }

    fn record_of(&self, changed: &Path) -> Option<PathBuf> {
        match changed
            .strip_prefix(&self.managers)
            .ok()?
            .components()
            .next()?
        {
            Component::Normal(name) => Some(self.managers.join(name)),
            _ => None,
        }
    }

    fn fingerprint(&self, record: &Path) -> Option<Fingerprint> {
        let dir = stat(record);
        dir.2.then(|| {
            vec![
                dir,
                stat(&record.join(GOAL_FILE)),
                stat(&record.join(STATE_FILE)),
                stat(&record.join(REVIEWS_DIR)),
            ]
        })
    }

    fn read(&self, record: &Path) -> Option<Fact> {
        if !record.is_dir() {
            return None;
        }
        let goal = first_line(&record.join(GOAL_FILE));
        let state = first_line(&record.join(STATE_FILE));
        let verdicts = verdicts(&record.join(REVIEWS_DIR));
        let last_verdict = verdicts.last().and_then(|(_, path)| first_line(path));
        Some(Fact::Manager(ManagerFact {
            dir: record.to_owned(),
            goal,
            state,
            reviews: u32::try_from(verdicts.len()).unwrap_or(u32::MAX),
            last_verdict,
        }))
    }
}

/// Verdict files by review number, lowest first.
fn verdicts(reviews: &Path) -> Vec<(u32, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(reviews) else {
        return Vec::new();
    };
    let mut verdicts: Vec<(u32, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter_map(|path| {
            if path.extension()? != VERDICT_EXTENSION {
                return None;
            }
            let number = path.file_stem()?.to_str()?.parse().ok()?;
            Some((number, path))
        })
        .collect();
    verdicts.sort();
    verdicts
}

fn first_line(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}
