//! The engine both transcript adapters share: watch a directory tree, index
//! recently written files newest first on blocking workers, then tail every
//! file that changes from its byte offset.
//!
//! Startup never reads the whole tree: only files modified inside the history
//! window are indexed, and lines without a cheap substring match are skipped
//! before any JSON parsing. A 30 s reconcile `stat`s the files already being
//! tailed, in case a notification was dropped; it is a safety net, not the
//! update path.

#[cfg(test)]
mod test;

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::Utc;
use rootcause::report;
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{Progress, SourceHealth, SourceKind, SourceState, Timestamp};
use crate::domain::observation::{
    Change, Fact, FactKey, Observation, TranscriptDelta, TranscriptEvent, TranscriptEventKind,
    TranscriptKey,
};
use crate::domain::source::SourceError;
use crate::outbound::tail::{Tail, TailPosition};
use crate::outbound::watch::Watch;

/// Files read at once.
const WORKERS: usize = 4;

/// How often the files being tailed are checked for a missed change.
pub(crate) const RECONCILE_EVERY: Duration = Duration::from_secs(30);

/// Indexing progress is reported after this many files.
const PROGRESS_EVERY: u32 = 25;

/// One transcript file format.
pub(crate) trait TranscriptFormat: Send + Sync + 'static {
    /// Reads one file's lines.
    type Parser: LineParser;

    /// The source these transcripts are filed under.
    const SOURCE: SourceKind;

    /// The transcript `path` holds, if it is a file this format reads.
    fn key(&self, root: &Path, path: &Path) -> Option<TranscriptKey>;

    /// A parser for one file, reading from its start. May read small files
    /// beside it; it runs on a blocking worker.
    fn parser(&self, path: &Path, key: &TranscriptKey) -> Self::Parser;
}

/// Turns one file's lines into transcript events.
pub(crate) trait LineParser: Send + 'static {
    /// A cheap check that skips lines this parser ignores, before any parsing.
    fn wants(&self, line: &[u8]) -> bool;

    /// Parses one wanted line into `out`. Lines that do not decode are skipped.
    fn parse(&mut self, line: &[u8], out: &mut Deltas);
}

/// Where to look and how far back.
#[derive(Clone, Debug)]
pub(crate) struct TranscriptConfig {
    /// The directory tree to watch.
    pub root: PathBuf,
    /// Files modified longer ago than this are not indexed at startup.
    pub history: Duration,
}

/// The metadata last sent for a file, so an unchanged value is not resent.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Sent {
    cwd: Option<PathBuf>,
    branch: Option<String>,
    model: Option<String>,
    title: Option<String>,
}

/// The deltas one read of a file produces. A new delta starts whenever the
/// model changes after usage was recorded, so the reducer prices each usage
/// record at the model that produced it.
#[derive(Debug)]
pub(crate) struct Deltas {
    key: TranscriptKey,
    path: PathBuf,
    from_start: bool,
    sent: Sent,
    list: Vec<TranscriptDelta>,
    /// The last record time, for records that carry none.
    last_at: Option<Timestamp>,
}

impl Deltas {
    fn new(key: TranscriptKey, path: PathBuf, from_start: bool, sent: Sent) -> Self {
        Self {
            key,
            path,
            from_start,
            sent,
            list: Vec::new(),
            last_at: None,
        }
    }

    fn current(&mut self) -> &mut TranscriptDelta {
        if self.list.is_empty() {
            let from_start = self.from_start;
            self.push_delta(from_start);
        }
        let last = self.list.len() - 1;
        &mut self.list[last]
    }

    fn push_delta(&mut self, from_start: bool) {
        self.list.push(TranscriptDelta {
            key: self.key.clone(),
            path: self.path.clone(),
            from_start,
            cwd: None,
            branch: None,
            model: None,
            title: None,
            events: Vec::new(),
        });
    }

    /// The time of the last record that carried one.
    pub fn last_at(&self) -> Option<Timestamp> {
        self.last_at
    }

    /// Notes a record's time.
    pub fn saw_time(&mut self, at: Timestamp) {
        self.last_at = Some(self.last_at.map_or(at, |last| last.max(at)));
    }

    /// Records one event.
    pub fn push(&mut self, at: Timestamp, kind: TranscriptEventKind) {
        self.saw_time(at);
        self.current().events.push(TranscriptEvent { at, kind });
    }

    /// Sets the working directory, if it changed.
    pub fn set_cwd(&mut self, cwd: PathBuf) {
        if self.sent.cwd.as_ref() != Some(&cwd) {
            self.sent.cwd = Some(cwd.clone());
            self.current().cwd = Some(cwd);
        }
    }

    /// Sets the git branch, if it changed.
    pub fn set_branch(&mut self, branch: String) {
        if self.sent.branch.as_ref() != Some(&branch) {
            self.sent.branch = Some(branch.clone());
            self.current().branch = Some(branch);
        }
    }

    /// Sets the title, if it changed.
    pub fn set_title(&mut self, title: String) {
        if self.sent.title.as_ref() != Some(&title) {
            self.sent.title = Some(title.clone());
            self.current().title = Some(title);
        }
    }

    /// Sets the model, if it changed; events after this are priced at it.
    pub fn set_model(&mut self, model: String) {
        if self.sent.model.as_ref() == Some(&model) {
            return;
        }
        let current_has_usage = self.list.last().is_some_and(|delta| {
            delta
                .events
                .iter()
                .any(|event| matches!(event.kind, TranscriptEventKind::Usage(_)))
        });
        if current_has_usage {
            self.push_delta(false);
        }
        self.sent.model = Some(model.clone());
        self.current().model = Some(model);
    }

    /// The deltas worth sending. An empty delta is kept only when it has to
    /// clear what was counted before (`from_start` on a file read before).
    fn finish(self, counted_before: bool) -> (Vec<TranscriptDelta>, Sent) {
        let clear = self.from_start && counted_before;
        let mut list = self.list;
        list.retain(|delta| {
            !delta.events.is_empty()
                || delta.cwd.is_some()
                || delta.branch.is_some()
                || delta.model.is_some()
                || delta.title.is_some()
        });
        if clear && list.first().is_none_or(|delta| !delta.from_start) {
            let mut deltas = Deltas::new(self.key, self.path, true, Sent::default());
            deltas.current();
            let mut cleared = deltas.list;
            cleared.extend(list);
            list = cleared;
        }
        (list, self.sent)
    }
}

/// What the engine keeps per tailed file.
struct FileState<P> {
    key: TranscriptKey,
    tail: Tail,
    parser: P,
    sent: Sent,
    counted: bool,
}

/// Reads everything new in one file, in as many batches as it takes.
fn read_file<F: TranscriptFormat>(
    format: &F,
    path: &Path,
    state: &mut FileState<F::Parser>,
) -> std::io::Result<(Vec<TranscriptDelta>, u64)> {
    let mut deltas = Vec::new();
    let mut bytes = 0;
    loop {
        let batch = state.tail.read(path)?;
        bytes += batch.bytes.len() as u64;
        if batch.from_start {
            state.parser = format.parser(path, &state.key);
            state.sent = Sent::default();
        }

        let mut out = Deltas::new(
            state.key.clone(),
            path.to_owned(),
            batch.from_start,
            std::mem::take(&mut state.sent),
        );
        for line in batch.lines() {
            if state.parser.wants(line) {
                state.parser.parse(line, &mut out);
            }
        }
        let (read, sent) = out.finish(state.counted);
        state.sent = sent;
        state.counted |= !read.is_empty();
        deltas.extend(read);

        if !batch.more {
            return Ok((deltas, bytes));
        }
    }
}

/// A file being read on a worker, or waiting for one.
enum Slot<P> {
    Idle(FileState<P>),
    /// Out on a worker; `again` when it changed meanwhile.
    Busy { again: bool },
}

struct JobDone<P> {
    path: PathBuf,
    state: Option<FileState<P>>,
    deltas: Vec<TranscriptDelta>,
    bytes: u64,
}

/// Runs a transcript source until cancelled.
pub(crate) async fn run<F: TranscriptFormat>(
    format: F,
    config: TranscriptConfig,
    out: mpsc::Sender<Observation>,
    cancel: CancellationToken,
) -> Result<(), SourceError> {
    let format = Arc::new(format);
    let sender = Sender { out, source: F::SOURCE };

    // Forget what an earlier run reported before anything else.
    sender.send(Change::Reset(Vec::new())).await?;
    if !config.root.is_dir() {
        sender
            .health(SourceState::Absent, 0, None, Some("no transcript directory"))
            .await?;
        cancel.cancelled().await;
        return Ok(());
    }

    // Watch first, so nothing written during the index is missed.
    let mut watch = Watch::new().map_err(internal)?;
    watch.add(&config.root, true).map_err(internal)?;

    let horizon = SystemTime::now()
        .checked_sub(config.history)
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let index = {
        let format = Arc::clone(&format);
        let root = config.root.clone();
        tokio::task::spawn_blocking(move || recent_files(&*format, &root, &root, horizon))
            .await
            .map_err(internal)?
    };

    let mut engine = Engine {
        format,
        root: config.root.clone(),
        horizon,
        sender,
        files: HashMap::new(),
        queue: VecDeque::new(),
        queued: BTreeSet::new(),
        jobs: JoinSet::new(),
        indexing: index.iter().cloned().collect(),
        index_total: u32::try_from(index.len()).unwrap_or(u32::MAX),
        index_span: tracing::info_span!(
            "macrod.monitor.index.scan",
            source = F::SOURCE.name(),
            files = index.len(),
            bytes = tracing::field::Empty,
            duration_ms = tracing::field::Empty,
        ),
        index_started: tokio::time::Instant::now(),
        index_bytes: 0,
    };
    for path in index {
        engine.enqueue(path, false);
    }
    engine.report_progress().await?;

    let mut reconcile = tokio::time::interval(RECONCILE_EVERY);
    reconcile.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    reconcile.tick().await;

    loop {
        engine.dispatch();
        tokio::select! {
            () = cancel.cancelled() => return Ok(()),
            changes = watch.next() => {
                let changes = changes.ok_or_else(|| internal("file watcher stopped"))?;
                engine.changed(changes.paths, changes.rescan).await?;
            }
            Some(done) = engine.jobs.join_next(), if !engine.jobs.is_empty() => {
                engine.finished(done.map_err(internal)?).await?;
            }
            _ = reconcile.tick() => engine.reconcile().await?,
        }
    }
}

struct Sender {
    out: mpsc::Sender<Observation>,
    source: SourceKind,
}

impl Sender {
    async fn send(&self, change: Change) -> Result<(), SourceError> {
        self.out
            .send(Observation {
                source: self.source,
                change,
            })
            .await
            .map_err(|_closed| SourceError::StoreClosed)
    }

    async fn health(
        &self,
        state: SourceState,
        items: usize,
        indexing: Option<Progress>,
        detail: Option<&str>,
    ) -> Result<(), SourceError> {
        let mut health = SourceHealth::starting(self.source);
        health.state = state;
        health.items = u32::try_from(items).unwrap_or(u32::MAX);
        health.indexing = indexing;
        health.detail = detail.map(str::to_owned);
        health.last_event = Some(Utc::now());
        self.send(Change::Health(health)).await
    }
}

struct Engine<F: TranscriptFormat> {
    format: Arc<F>,
    root: PathBuf,
    horizon: SystemTime,
    sender: Sender,
    files: HashMap<PathBuf, Slot<F::Parser>>,
    queue: VecDeque<PathBuf>,
    queued: BTreeSet<PathBuf>,
    jobs: JoinSet<JobDone<F::Parser>>,
    indexing: BTreeSet<PathBuf>,
    index_total: u32,
    index_span: tracing::Span,
    index_started: tokio::time::Instant,
    index_bytes: u64,
}

impl<F: TranscriptFormat> Engine<F> {
    /// Queues a file for reading; a live change goes ahead of the index.
    fn enqueue(&mut self, path: PathBuf, urgent: bool) {
        if let Some(Slot::Busy { again }) = self.files.get_mut(&path) {
            *again = true;
            return;
        }
        if !self.queued.insert(path.clone()) {
            return;
        }
        if urgent {
            self.queue.push_front(path);
        } else {
            self.queue.push_back(path);
        }
    }

    /// Starts reads until every worker is busy.
    fn dispatch(&mut self) {
        while self.jobs.len() < WORKERS {
            let Some(path) = self.queue.pop_front() else {
                return;
            };
            self.queued.remove(&path);

            let state = match self.files.insert(path.clone(), Slot::Busy { again: false }) {
                Some(Slot::Idle(state)) => Some(state),
                Some(Slot::Busy { .. }) | None => None,
            };
            let Some(key) = state
                .as_ref()
                .map(|state| state.key.clone())
                .or_else(|| self.format.key(&self.root, &path))
            else {
                self.files.remove(&path);
                continue;
            };

            let format = Arc::clone(&self.format);
            self.jobs.spawn_blocking(move || read_job(&*format, path, key, state));
        }
    }

    async fn finished(&mut self, done: JobDone<F::Parser>) -> Result<(), SourceError> {
        let again = matches!(
            self.files.get(&done.path),
            Some(Slot::Busy { again: true })
        );
        match done.state {
            Some(state) => {
                self.files.insert(done.path.clone(), Slot::Idle(state));
            }
            None => {
                // The file is gone; tell the store if it ever heard of it.
                self.files.remove(&done.path);
                if let Some(key) = self.format.key(&self.root, &done.path) {
                    self.sender
                        .send(Change::Remove(FactKey::Transcript(key)))
                        .await?;
                }
            }
        }

        for delta in done.deltas {
            self.sender
                .send(Change::Upsert(Fact::Transcript(delta)))
                .await?;
        }

        if self.indexing.remove(&done.path) {
            self.index_bytes += done.bytes;
            let finished = self.indexing.is_empty();
            let done_count = self.index_total - u32::try_from(self.indexing.len()).unwrap_or(0);
            if finished || done_count.is_multiple_of(PROGRESS_EVERY) {
                self.report_progress().await?;
            }
        }
        if again {
            self.enqueue(done.path, true);
        }
        Ok(())
    }

    async fn report_progress(&mut self) -> Result<(), SourceError> {
        let remaining = u32::try_from(self.indexing.len()).unwrap_or(u32::MAX);
        let indexing = (remaining > 0).then_some(Progress {
            done: self.index_total - remaining,
            total: self.index_total,
        });
        if indexing.is_none() {
            let elapsed = self.index_started.elapsed();
            self.index_span
                .record("duration_ms", u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX));
            self.index_span.record("bytes", self.index_bytes);
            self.index_span = tracing::Span::none();
        }
        self.sender
            .health(SourceState::Healthy, self.files.len(), indexing, None)
            .await
    }

    async fn changed(
        &mut self,
        paths: BTreeSet<PathBuf>,
        rescan: bool,
    ) -> Result<(), SourceError> {
        let mut new_directories = Vec::new();
        for path in paths {
            if self.format.key(&self.root, &path).is_some() {
                self.enqueue(path, true);
            } else if path.is_dir() {
                new_directories.push(path);
            }
        }
        if rescan {
            new_directories.push(self.root.clone());
        }

        // A directory created before its watch was added may already hold
        // files; a rescan after dropped events looks at everything recent.
        for directory in new_directories {
            let horizon = if directory == self.root {
                self.horizon
            } else {
                SystemTime::UNIX_EPOCH
            };
            let format = Arc::clone(&self.format);
            let root = self.root.clone();
            let found = tokio::task::spawn_blocking(move || {
                recent_files(&*format, &root, &directory, horizon)
            })
            .await
            .map_err(internal)?;
            for path in found {
                self.enqueue(path, true);
            }
        }
        if rescan {
            self.reconcile().await?;
        }
        Ok(())
    }

    /// `stat`s every idle file and queues the ones that changed unnoticed.
    async fn reconcile(&mut self) -> Result<(), SourceError> {
        let positions: Vec<(PathBuf, TailPosition)> = self
            .files
            .iter()
            .filter_map(|(path, slot)| match slot {
                Slot::Idle(state) => Some((path.clone(), state.tail.position())),
                Slot::Busy { .. } => None,
            })
            .collect();
        let stale = tokio::task::spawn_blocking(move || {
            positions
                .into_iter()
                .filter(|(path, position)| {
                    std::fs::metadata(path).map_or(true, |metadata| position.is_stale(&metadata))
                })
                .map(|(path, _)| path)
                .collect::<Vec<_>>()
        })
        .await
        .map_err(internal)?;

        for path in stale {
            self.enqueue(path, true);
        }
        Ok(())
    }
}

fn read_job<F: TranscriptFormat>(
    format: &F,
    path: PathBuf,
    key: TranscriptKey,
    state: Option<FileState<F::Parser>>,
) -> JobDone<F::Parser> {
    let span = tracing::info_span!(
        "macrod.monitor.source.batch",
        source = F::SOURCE.name(),
        observations = tracing::field::Empty,
        bytes = tracing::field::Empty,
    );
    let _entered = span.enter();

    let mut state = state.unwrap_or_else(|| FileState {
        parser: format.parser(&path, &key),
        key,
        tail: Tail::default(),
        sent: Sent::default(),
        counted: false,
    });
    match read_file(format, &path, &mut state) {
        Ok((deltas, bytes)) => {
            span.record("observations", deltas.len());
            span.record("bytes", bytes);
            JobDone {
                path,
                state: Some(state),
                deltas,
                bytes,
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => JobDone {
            path,
            state: None,
            deltas: Vec::new(),
            bytes: 0,
        },
        Err(error) => {
            // One unreadable file never stops the source; it is retried on
            // its next change.
            tracing::warn!(error = %error, "transcript read failed");
            JobDone {
                path,
                state: Some(state),
                deltas: Vec::new(),
                bytes: 0,
            }
        }
    }
}

/// Transcript files under `directory` modified at or after `horizon`, newest
/// first.
fn recent_files<F: TranscriptFormat>(
    format: &F,
    root: &Path,
    directory: &Path,
    horizon: SystemTime,
) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![directory.to_owned()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if format.key(root, &path).is_none() {
                continue;
            }
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            if modified >= horizon {
                found.push((modified, path));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

fn internal<E: std::fmt::Display>(error: E) -> SourceError {
    SourceError::Internal(report!(error.to_string()).into_dynamic())
}
