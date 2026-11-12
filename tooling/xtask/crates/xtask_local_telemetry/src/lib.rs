//! Opt-in telemetry for `just run_local`: how long a bring-up, each of its steps,
//! each build and each service's health wait took, sent to Loki as OTLP logs (the
//! same design as CI's `service_name="ci-telemetry"` events) and, as spans, to
//! Tempo.
//!
//! Off unless the user's opt-in file exists (see [`config`]); then [`Recorder::start`]
//! returns `None` and nothing is written or sent. On, every event is appended to a
//! buffer file first and a background thread sends it, so recording never waits
//! on the network. A process killed mid-run leaves its file behind, and the next
//! recording process sends it, closed off as an `interrupted` run.

#![deny(missing_docs)]

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub mod config;
mod otlp;
mod sender;

#[cfg(test)]
mod test;

pub use config::{ConfigError, Paths};

/// One thing that happened: a finished step, a build, a service turning healthy.
#[derive(Clone, Debug)]
pub struct Event {
    event: String,
    name: Option<String>,
    at: SystemTime,
    duration: Option<Duration>,
    fields: BTreeMap<String, Value>,
}

impl Event {
    /// An event of `kind` (the `event` field Loki queries filter on), ending now.
    pub fn new(kind: &str) -> Self {
        Self {
            event: kind.to_owned(),
            name: None,
            at: SystemTime::now(),
            duration: None,
            fields: BTreeMap::new(),
        }
    }

    /// A structured-metadata field. Keep values low in size; never paths or secrets.
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.fields.insert(key.to_owned(), value.into());
        self
    }

    /// How long it took, ending at the event's time. Also makes it a span named `name`.
    pub fn lasting(mut self, name: &str, duration: Duration) -> Self {
        self.name = Some(name.to_owned());
        self.duration = Some(duration);
        self
    }

    /// Set when it ended, for an event recorded after the fact.
    pub fn at(mut self, at: SystemTime) -> Self {
        self.at = at;
        self
    }
}

/// Why telemetry stayed off for this process although the user opted in.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    /// The opt-in file can't be used.
    #[error(transparent)]
    Config(#[from] ConfigError),
    /// The buffer directory or file couldn't be created and locked.
    #[error("cannot buffer telemetry in {path}: {source}")]
    Buffer {
        /// The buffer file or directory.
        path: PathBuf,
        /// What failed.
        source: std::io::Error,
    },
}

/// The first line of every buffer file: what every event of the run shares.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Begin {
    pub run_id: String,
    pub started_ns: u64,
    pub common: BTreeMap<String, Value>,
}

/// A recorded event, as buffered.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Record {
    pub seq: u32,
    pub event: String,
    pub name: Option<String>,
    pub at_ns: u64,
    pub duration_ns: Option<u64>,
    pub fields: BTreeMap<String, Value>,
}

/// One line of a buffer file.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "line", rename_all = "snake_case")]
pub(crate) enum Line {
    Begin(Begin),
    /// A step began. Never sent: it names what an interrupted run was doing.
    Started {
        step: String,
        at_ns: u64,
    },
    Record(Record),
}

/// The event that closes a run, and the root span its steps hang under.
pub(crate) const RUN_EVENT: &str = "run";

/// Records one process's events: one run (a bring-up, a rebuild, a stop).
pub struct Recorder {
    shared: Arc<Shared>,
    done: mpsc::Receiver<()>,
}

pub(crate) struct Shared {
    pub begin: Begin,
    pub own_file: PathBuf,
    buffer: Mutex<Buffer>,
    signal: Mutex<Signal>,
    wake: Condvar,
}

struct Buffer {
    /// Holds the exclusive lock that tells other processes this run is alive.
    file: File,
    next_seq: u32,
}

#[derive(Default)]
struct Signal {
    flush: bool,
    shutdown: bool,
}

impl Shared {
    fn append(&self, line: &Line) {
        let Ok(mut text) = serde_json::to_string(line) else {
            return;
        };
        text.push('\n');
        let mut buffer = self.buffer.lock().unwrap_or_else(PoisonError::into_inner);
        // A full disk costs this event only; the run carries on.
        let _ = buffer.file.write_all(text.as_bytes());
    }

    fn next_seq(&self) -> u32 {
        let mut buffer = self.buffer.lock().unwrap_or_else(PoisonError::into_inner);
        buffer.next_seq += 1;
        buffer.next_seq
    }

    fn notify(&self, shutdown: bool) {
        let mut signal = self.signal.lock().unwrap_or_else(PoisonError::into_inner);
        signal.flush = true;
        signal.shutdown |= shutdown;
        self.wake.notify_all();
    }

    /// Wait until asked to flush or `interval` passes; true once shutting down.
    pub(crate) fn wait(&self, interval: Duration) -> bool {
        let signal = self.signal.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut signal, _) = self
            .wake
            .wait_timeout_while(signal, interval, |signal| !signal.flush)
            .unwrap_or_else(PoisonError::into_inner);
        signal.flush = false;
        signal.shutdown
    }
}

impl Recorder {
    /// Start recording a run that began at `started_at`, if the user opted in.
    /// `common` builds the fields every event carries (kind, mode, instance,
    /// host, ...); it is only called once the user has opted in.
    ///
    /// `Ok(None)` means opted out: nothing was created, `common` was not called,
    /// and nothing will be sent.
    pub fn start(
        paths: &Paths,
        started_at: SystemTime,
        common: impl FnOnce() -> BTreeMap<String, Value>,
    ) -> Result<Option<Self>, StartError> {
        let Some(config) = config::Config::load(&paths.config)? else {
            return Ok(None);
        };
        let buffer_error = |path: &PathBuf| {
            let path = path.clone();
            move |source| StartError::Buffer { path, source }
        };
        std::fs::create_dir_all(&paths.buffer_dir).map_err(buffer_error(&paths.buffer_dir))?;

        let run_id = uuid::Uuid::now_v7().simple().to_string();
        let begin = Begin {
            run_id,
            started_ns: unix_ns(started_at),
            common: common(),
        };
        let own_file = paths.buffer_dir.join(format!("{}.jsonl", begin.run_id));
        // Locked and holding its begin line before it gets the name other
        // processes look for, so none of them takes it for a dead run's.
        let staging = own_file.with_extension("new");
        let mut file = File::options()
            .create_new(true)
            .append(true)
            .open(&staging)
            .map_err(buffer_error(&staging))?;
        file.try_lock()
            .map_err(|error| std::io::Error::other(error.to_string()))
            .and_then(|()| {
                let mut line = serde_json::to_string(&Line::Begin(begin.clone()))?;
                line.push('\n');
                file.write_all(line.as_bytes())
            })
            .and_then(|()| std::fs::rename(&staging, &own_file))
            .map_err(buffer_error(&own_file))?;

        let shared = Arc::new(Shared {
            begin,
            own_file,
            buffer: Mutex::new(Buffer { file, next_seq: 0 }),
            signal: Mutex::new(Signal::default()),
            wake: Condvar::new(),
        });

        let (done_tx, done) = mpsc::channel();
        let sender_shared = Arc::clone(&shared);
        let buffer_dir = paths.buffer_dir.clone();
        std::thread::Builder::new()
            .name("local-telemetry".to_owned())
            .spawn(move || {
                sender::run(&config, &buffer_dir, &sender_shared);
                let _ = done_tx.send(());
            })
            .map_err(buffer_error(&paths.buffer_dir))?;
        Ok(Some(Self { shared, done }))
    }

    /// This run's id, the `run_id` field of every event.
    pub fn run_id(&self) -> &str {
        &self.shared.begin.run_id
    }

    /// Note that a step began. Only an interrupted run reports it, as the step it
    /// was in when it stopped.
    pub fn step_started(&self, step: &str) {
        self.shared.append(&Line::Started {
            step: step.to_owned(),
            at_ns: unix_ns(SystemTime::now()),
        });
    }

    /// Buffer an event. It is sent within a flush interval, or when the run finishes.
    pub fn record(&self, event: Event) {
        let seq = self.shared.next_seq();
        self.shared.append(&Line::Record(Record {
            seq,
            event: event.event,
            name: event.name,
            at_ns: unix_ns(event.at),
            duration_ns: event
                .duration
                .map(|d| u64::try_from(d.as_nanos()).unwrap_or(u64::MAX)),
            fields: event.fields,
        }));
    }

    /// Close the run with its `run` event, lasting from its start until `ended`,
    /// and send what is buffered. Waits at most `wait` for the send: whatever
    /// isn't delivered by then stays buffered, and a later run sends it.
    pub fn finish(self, fields: BTreeMap<String, Value>, ended: SystemTime, wait: Duration) {
        let started = UNIX_EPOCH + Duration::from_nanos(self.shared.begin.started_ns);
        let mut event = Event::new(RUN_EVENT)
            .at(ended)
            .lasting(RUN_EVENT, ended.duration_since(started).unwrap_or_default());
        event.fields = fields;
        self.record(event);
        self.shared.notify(true);
        let _ = self.done.recv_timeout(wait);
    }
}

impl Drop for Recorder {
    /// A run that ends without [`Recorder::finish`] still sends what it has.
    fn drop(&mut self) {
        self.shared.notify(true);
    }
}

pub(crate) fn unix_ns(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_nanos()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

/// A stable opaque id for a value that must not be sent as is, such as a host
/// name or a worktree path: the first 12 hex digits of its SHA-256.
pub fn opaque_id(value: &str) -> String {
    hex_digest(value.as_bytes())[..12].to_owned()
}

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
