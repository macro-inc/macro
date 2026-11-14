//! The engine the small-record adapters share: a few directories of small
//! files (one record per file or directory), read whole on every change.
//!
//! A record is read again when a notification names it, and sent only when
//! the fact it decodes to changes. A 30 s reconcile lists the directories
//! again and re-reads only records whose stat fingerprint changed, in case a
//! notification was dropped or a watched directory appeared.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use chrono::Utc;
use rootcause::report;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{SourceHealth, SourceKind, SourceState};
use crate::domain::observation::{Change, Fact, Observation};
use crate::domain::source::SourceError;
use crate::outbound::transcripts::RECONCILE_EVERY;
use crate::outbound::watch::Watch;

/// A directory to watch.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct WatchedDir {
    pub path: PathBuf,
    pub recursive: bool,
}

/// The stat-only signature of a record: the length and modification time of
/// each file it is read from, plus anything else that changes what it decodes
/// to (such as whether its process is alive).
pub(crate) type Fingerprint = Vec<(u64, Option<SystemTime>, bool)>;

/// One kind of record.
pub(crate) trait RecordFormat: Send + Sync + 'static {
    /// The source these records are filed under.
    const SOURCE: SourceKind;

    /// The directories to watch now. Called again on every reconcile, so a
    /// directory that appears later is picked up.
    fn watched(&self) -> Vec<WatchedDir>;

    /// Every record that exists now.
    fn list(&self) -> Vec<PathBuf>;

    /// The record a changed path belongs to, if any.
    fn record_of(&self, changed: &Path) -> Option<PathBuf>;

    /// The record's fingerprint; `None` when it is gone.
    fn fingerprint(&self, record: &Path) -> Option<Fingerprint>;

    /// The fact the record decodes to; `None` when it is unreadable or should
    /// not be reported.
    fn read(&self, record: &Path) -> Option<Fact>;
}

/// A stat entry for one file: its length, modification time and existence.
pub(crate) fn stat(path: &Path) -> (u64, Option<SystemTime>, bool) {
    match std::fs::metadata(path) {
        Ok(metadata) => (metadata.len(), metadata.modified().ok(), true),
        Err(_) => (0, None, false),
    }
}

#[derive(Default)]
struct Known {
    fingerprint: Fingerprint,
    fact: Option<Fact>,
}

/// Runs a record source until cancelled.
pub(crate) async fn run<F: RecordFormat>(
    format: F,
    out: mpsc::Sender<Observation>,
    cancel: CancellationToken,
) -> Result<(), SourceError> {
    let format = Arc::new(format);
    let mut engine = Engine {
        format,
        out,
        watch: Watch::new().map_err(internal)?,
        watching: BTreeSet::new(),
        known: BTreeMap::new(),
    };

    engine.watch_new_dirs();
    if engine.watching.is_empty() {
        engine
            .health(SourceState::Absent, Some("no record directory"))
            .await?;
    }
    let facts = engine.scan_all().await?;
    engine.send(Change::Reset(facts)).await?;
    if !engine.watching.is_empty() {
        engine.health(SourceState::Healthy, None).await?;
    }

    let mut reconcile = tokio::time::interval(RECONCILE_EVERY);
    reconcile.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    reconcile.tick().await;

    loop {
        tokio::select! {
            () = cancel.cancelled() => return Ok(()),
            changes = engine.watch.next() => {
                let changes = changes.ok_or_else(|| internal("file watcher stopped"))?;
                let records: BTreeSet<PathBuf> = changes
                    .paths
                    .iter()
                    .filter_map(|path| engine.format.record_of(path))
                    .collect();
                if changes.rescan {
                    engine.reconcile().await?;
                } else {
                    engine.refresh(records, Reread::Always).await?;
                }
            }
            _ = reconcile.tick() => engine.reconcile().await?,
        }
    }
}

/// When a record is read again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Reread {
    /// On a notification: two writes within the file system's timestamp
    /// granularity can leave length and modification time unchanged.
    Always,
    /// On a reconcile, which must stay a cheap `stat` sweep.
    IfChanged,
}

struct Engine<F: RecordFormat> {
    format: Arc<F>,
    out: mpsc::Sender<Observation>,
    watch: Watch,
    watching: BTreeSet<WatchedDir>,
    known: BTreeMap<PathBuf, Known>,
}

impl<F: RecordFormat> Engine<F> {
    async fn send(&self, change: Change) -> Result<(), SourceError> {
        self.out
            .send(Observation {
                source: F::SOURCE,
                change,
            })
            .await
            .map_err(|_closed| SourceError::StoreClosed)
    }

    async fn health(&self, state: SourceState, detail: Option<&str>) -> Result<(), SourceError> {
        let mut health = SourceHealth::starting(F::SOURCE);
        health.state = state;
        health.detail = detail.map(str::to_owned);
        let items = self.known.values().filter(|known| known.fact.is_some()).count();
        health.items = u32::try_from(items).unwrap_or(u32::MAX);
        health.last_event = Some(Utc::now());
        self.send(Change::Health(health)).await
    }

    /// Adds watches for directories that exist now and are not watched yet.
    fn watch_new_dirs(&mut self) -> bool {
        let mut added = false;
        for dir in self.format.watched() {
            if self.watching.contains(&dir) || !dir.path.is_dir() {
                continue;
            }
            match self.watch.add(&dir.path, dir.recursive) {
                Ok(()) => {
                    self.watching.insert(dir);
                    added = true;
                }
                Err(error) => tracing::warn!(error = %error, "cannot watch a record directory"),
            }
        }
        added
    }

    /// Reads every record from scratch.
    async fn scan_all(&mut self) -> Result<Vec<Fact>, SourceError> {
        let format = Arc::clone(&self.format);
        let read = tokio::task::spawn_blocking(move || {
            let span = tracing::info_span!(
                "macrod.monitor.source.batch",
                source = F::SOURCE.name(),
                observations = tracing::field::Empty,
            );
            let _entered = span.enter();
            let read: Vec<(PathBuf, Option<Fingerprint>, Option<Fact>)> = format
                .list()
                .into_iter()
                .map(|record| {
                    let fingerprint = format.fingerprint(&record);
                    let fact = fingerprint.as_ref().and_then(|_| format.read(&record));
                    (record, fingerprint, fact)
                })
                .collect();
            span.record("observations", read.len());
            read
        })
        .await
        .map_err(internal)?;

        let mut facts = Vec::new();
        for (record, fingerprint, fact) in read {
            let Some(fingerprint) = fingerprint else {
                continue;
            };
            facts.extend(fact.clone());
            self.known.insert(record, Known { fingerprint, fact });
        }
        Ok(facts)
    }

    /// Re-reads the given records, or with [`Reread::IfChanged`] only those
    /// whose fingerprint changed.
    async fn refresh(
        &mut self,
        records: BTreeSet<PathBuf>,
        reread: Reread,
    ) -> Result<(), SourceError> {
        if records.is_empty() {
            return Ok(());
        }
        let format = Arc::clone(&self.format);
        let previous: Vec<(PathBuf, Option<Fingerprint>)> = records
            .into_iter()
            .map(|record| {
                let fingerprint = self.known.get(&record).map(|known| known.fingerprint.clone());
                (record, fingerprint)
            })
            .collect();
        let changed = tokio::task::spawn_blocking(move || {
            previous
                .into_iter()
                .filter_map(|(record, before)| {
                    let now = format.fingerprint(&record);
                    if reread == Reread::IfChanged && now.is_some() && now == before {
                        return None;
                    }
                    let fact = now.as_ref().and_then(|_| format.read(&record));
                    Some((record, now, fact))
                })
                .collect::<Vec<_>>()
        })
        .await
        .map_err(internal)?;

        for (record, fingerprint, fact) in changed {
            self.apply(record, fingerprint, fact).await?;
        }
        Ok(())
    }

    async fn apply(
        &mut self,
        record: PathBuf,
        fingerprint: Option<Fingerprint>,
        fact: Option<Fact>,
    ) -> Result<(), SourceError> {
        let before = match fingerprint {
            Some(fingerprint) => self
                .known
                .insert(
                    record,
                    Known {
                        fingerprint,
                        fact: fact.clone(),
                    },
                )
                .and_then(|known| known.fact),
            None => self.known.remove(&record).and_then(|known| known.fact),
        };

        match (before, fact) {
            (before, Some(fact)) if before.as_ref() != Some(&fact) => {
                self.send(Change::Upsert(fact)).await
            }
            (Some(before), None) => self.send(Change::Remove(before.key())).await,
            _ => Ok(()),
        }
    }

    /// Lists every directory again and re-reads what changed or appeared.
    async fn reconcile(&mut self) -> Result<(), SourceError> {
        if self.watch_new_dirs() {
            self.health(SourceState::Healthy, None).await?;
        }
        let format = Arc::clone(&self.format);
        let listed = tokio::task::spawn_blocking(move || format.list())
            .await
            .map_err(internal)?;
        let mut records: BTreeSet<PathBuf> = listed.into_iter().collect();
        records.extend(self.known.keys().cloned());
        self.refresh(records, Reread::IfChanged).await
    }
}

fn internal<E: std::fmt::Display>(error: E) -> SourceError {
    SourceError::Internal(report!(error.to_string()).into_dynamic())
}
