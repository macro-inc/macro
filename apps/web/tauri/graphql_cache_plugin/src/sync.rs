//! Streamed cache sync on the native host. Contract:
//! `apps/web/src/lib/graphql-cache/sync-protocol.ts` and
//! `docs/architecture/streamed-cache-sync.md`.
//!
//! The plugin opens the HTTP stream itself, through the [`SyncStreamOpener`]
//! the app installs at setup (it carries the app's session), and writes each
//! decoded frame into the engine; no sync data crosses the webview. One run
//! at a time per database: a second start answers `busy`.
//!
//! A reader task keeps reading the response while the engine writes, up to
//! [`READ_AHEAD_BYTES`] of received but unapplied bytes, so the server
//! prepares later pages during writes instead of idling.

use crate::engine::{NativeSyncHooks, SyncPublication, WeakEngineHandle, WriteResultWire};
use async_trait::async_trait;
use cache_core::sync::{SyncHooks, SyncRun, SyncRunResult, SyncStartArgs};
use serde::ser::{Serialize, SerializeStruct, Serializer};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

/// Headers the run sets itself, overriding the plan's.
const CONTENT_TYPE: &str = "content-type";
const ACCEPT: &str = "accept";
const ACCEPT_ENCODING: &str = "accept-encoding";
const NDJSON: &str = "application/x-ndjson";
/// The stream is NDJSON that gzips about 8×; the run decodes it itself.
const GZIP: &str = "gzip";

/// Response bytes read ahead of the cache: received from the network but not
/// yet applied. 16 MiB holds about 15 first-pass pages (≈1 MB each at most),
/// enough for the server to keep computing pages while one page is written,
/// while memory stays bounded at this cap plus one body chunk. Same value as
/// `SYNC_READ_AHEAD_BYTES` in the browser driver.
pub(crate) const READ_AHEAD_BYTES: usize = 16 * 1024 * 1024;

/// Hydrated pages publish at most this often: they only tell hydration
/// subscribers that a newer revision exists, so faster pages need not wake
/// them more often. Every other publication goes out at once, after the pages
/// written before it.
pub(crate) const PUBLISH_INTERVAL: Duration = Duration::from_millis(250);

/// How long a run waits for the response, or for the next bytes of its body,
/// before it gives the connection up as stalled: a connection that went
/// silent (a dropped network path) never fails by itself. A healthy stream is
/// silent for at most the server's page limit (45 s) plus one `waiting`
/// interval (10 s). Same value as `SYNC_STALL_MS` in the browser driver.
pub(crate) const STALL_TIMEOUT: Duration = Duration::from_secs(90);

/// The stream request: `POST url` with a JSON body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncHttpRequest {
    /// Absolute stream URL from the plan.
    pub url: String,
    /// Plan headers (mail cache profile, bearer token) plus content negotiation.
    pub headers: Vec<(String, String)>,
    /// JSON request body.
    pub body: Vec<u8>,
}

/// Why opening or reading the stream failed.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SyncHttpError(
    /// Diagnostic, without header values.
    pub String,
);

/// A response whose status arrived and whose body is still streaming.
pub struct SyncHttpResponse {
    /// HTTP status code.
    pub status: u16,
    /// The `content-encoding` response header, if any. The body is passed on
    /// as received; the run decodes `gzip` itself.
    pub content_encoding: Option<String>,
    /// The body; dropping it closes the connection, which stops the server.
    pub body: Box<dyn SyncResponseBody>,
}

/// Opens the stream with the app's session (cookies). `#[async_trait]`
/// because it must be object-safe: the app installs it as
/// `Arc<dyn SyncStreamOpener>` at setup.
#[async_trait]
pub trait SyncStreamOpener: Send + Sync {
    /// Sends `request`; resolves once the response status arrives.
    async fn open(&self, request: SyncHttpRequest) -> Result<SyncHttpResponse, SyncHttpError>;
}

/// A streaming response body. `#[async_trait]` for object safety, like
/// [`SyncStreamOpener`].
#[async_trait]
pub trait SyncResponseBody: Send {
    /// The next chunk of body bytes as received (still content-encoded), or
    /// `None` at the end of the body.
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, SyncHttpError>;
}

/// Why a run did not complete (`SyncFailure` in `sync-protocol.ts`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncFailure {
    /// Another run is in progress.
    Busy,
    /// This host cannot stream (no opener installed).
    Unsupported,
    /// Stopped by `sync_stop`, suspension, clear, or cache shutdown.
    Aborted,
    /// The server answered with a non-success status.
    Http {
        /// Response status.
        status: u16,
    },
    /// The request failed, or the stream broke the contract or ended early.
    Stream {
        /// Diagnostic.
        message: String,
    },
    /// No response, or no response bytes, for [`STALL_TIMEOUT`].
    Stalled,
    /// Writing a frame into the cache failed.
    Write {
        /// Diagnostic.
        message: String,
    },
}

/// How a run ended (`SyncRunOutcome` in `sync-protocol.ts`).
#[derive(Clone, Debug, PartialEq)]
pub enum SyncRunOutcome {
    /// The stream ended cleanly with `end: complete` or `end: maxPages`.
    Completed(SyncRunResult),
    /// The run stopped early; pages written before it stopped are kept.
    Failed {
        /// Why it stopped.
        failure: SyncFailure,
        /// Progress made, when the run started.
        partial: Option<SyncRunResult>,
    },
}

impl SyncRunOutcome {
    fn failed(failure: SyncFailure) -> Self {
        Self::Failed {
            failure,
            partial: None,
        }
    }
}

impl Serialize for SyncRunOutcome {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Completed(result) => {
                let mut outcome = serializer.serialize_struct("SyncRunOutcome", 2)?;
                outcome.serialize_field("ok", &true)?;
                outcome.serialize_field("result", result)?;
                outcome.end()
            }
            Self::Failed { failure, partial } => {
                let mut outcome = serializer.serialize_struct("SyncRunOutcome", 3)?;
                outcome.serialize_field("ok", &false)?;
                outcome.serialize_field("failure", failure)?;
                if let Some(partial) = partial {
                    outcome.serialize_field("partial", partial)?;
                } else {
                    outcome.skip_field("partial")?;
                }
                outcome.end()
            }
        }
    }
}

#[derive(Clone, Default)]
struct ActiveRun {
    cancel: CancellationToken,
    tracker: TaskTracker,
}

/// The run in progress, and how runs open their stream.
pub(crate) struct SyncRuns {
    opener: OnceLock<Arc<dyn SyncStreamOpener>>,
    active: Arc<Mutex<Option<ActiveRun>>>,
    /// Received but unapplied bytes a run may hold ([`READ_AHEAD_BYTES`]).
    read_ahead_bytes: usize,
    /// How often hydrated pages publish ([`PUBLISH_INTERVAL`]).
    publish_interval: Duration,
    /// How long a run waits for the response or its next bytes
    /// ([`STALL_TIMEOUT`]).
    stall_timeout: Duration,
}

impl Default for SyncRuns {
    fn default() -> Self {
        Self {
            opener: OnceLock::new(),
            active: Arc::default(),
            read_ahead_bytes: READ_AHEAD_BYTES,
            publish_interval: PUBLISH_INTERVAL,
            stall_timeout: STALL_TIMEOUT,
        }
    }
}

impl SyncRuns {
    pub(crate) fn install_opener(&self, opener: Arc<dyn SyncStreamOpener>) {
        if self.opener.set(opener).is_err() {
            tracing::warn!("graphql cache sync opener installed twice; keeping the first");
        }
    }

    /// Runs one stream to its end, its failure, or a stop. The run is its own
    /// task, so it finishes (and keeps publishing) even when the webview that
    /// started it reloads.
    pub(crate) async fn start(
        &self,
        engine: WeakEngineHandle,
        args: SyncStartArgs,
        publish: impl Fn(SyncPublication) + Send + 'static,
    ) -> SyncRunOutcome {
        let Some(opener) = self.opener.get().cloned() else {
            return SyncRunOutcome::failed(SyncFailure::Unsupported);
        };
        let hooks = NativeSyncHooks::new();
        let run = match SyncRun::new(&args, hooks.monotonic_ms()) {
            Ok(run) => run,
            Err(error) => {
                return SyncRunOutcome::failed(SyncFailure::Stream {
                    message: error.to_string(),
                });
            }
        };
        let active = ActiveRun::default();
        {
            // Guards never panic while held; a poisoned slot is still accurate.
            let mut slot = self.active.lock().unwrap_or_else(PoisonError::into_inner);
            if slot.is_some() {
                return SyncRunOutcome::failed(SyncFailure::Busy);
            }
            *slot = Some(active.clone());
        }
        let (outcome_tx, outcome_rx) = oneshot::channel();
        let slot = Arc::clone(&self.active);
        let cancel = active.cancel.clone();
        let read_ahead_bytes = self.read_ahead_bytes;
        let publish_interval = self.publish_interval;
        let stall_timeout = self.stall_timeout;
        tauri::async_runtime::spawn(active.tracker.track_future(async move {
            let stream = Stream {
                opener: opener.as_ref(),
                read_ahead_bytes,
                publish_interval,
                stall_timeout,
                cancel: &cancel,
            };
            let outcome = drive(&engine, stream, &args, run, &hooks, publish).await;
            // Free the slot before reporting, so whoever sees the outcome can start again.
            *slot.lock().unwrap_or_else(PoisonError::into_inner) = None;
            // The webview that started the run may be gone; nobody needs the outcome then.
            let _ = outcome_tx.send(outcome);
        }));
        active.tracker.close();
        outcome_rx
            .await
            .unwrap_or_else(|_| SyncRunOutcome::failed(SyncFailure::Aborted))
    }

    /// Stops the run in progress, if any, and waits until it has stopped.
    pub(crate) async fn stop(&self) {
        let active = self.active();
        if let Some(active) = active {
            active.cancel.cancel();
            active.tracker.wait().await;
        }
    }

    /// Stops the run in progress, if any, and blocks until it has stopped:
    /// at most the page being written. Only for threads that are not driving
    /// async tasks (app exit, the desktop installer's blocking thread).
    pub(crate) fn stop_blocking(&self) {
        if let Some(active) = self.active() {
            active.cancel.cancel();
            tauri::async_runtime::block_on(active.tracker.wait());
        }
    }

    /// Stops the run in progress, if any, without waiting (suspension).
    pub(crate) fn cancel(&self) {
        if let Some(active) = self.active() {
            active.cancel.cancel();
        }
    }

    fn active(&self) -> Option<ActiveRun> {
        self.active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

/// One run: reads the stream, then checks that it ended cleanly.
#[tracing::instrument(
    name = "graphql_cache.sync_run",
    skip_all,
    fields(
        lanes = args.lanes.len(),
        bytes = tracing::field::Empty,
        outcome = tracing::field::Empty
    )
)]
async fn drive(
    engine: &WeakEngineHandle,
    stream: Stream<'_>,
    args: &SyncStartArgs,
    mut run: SyncRun,
    hooks: &NativeSyncHooks,
    publish: impl Fn(SyncPublication),
) -> SyncRunOutcome {
    let read = read_stream(engine, stream, args, &mut run, hooks, publish).await;
    let now = hooks.monotonic_ms();
    let outcome = match read.and_then(|()| {
        run.finish(now).map_err(|error| SyncFailure::Stream {
            message: error.to_string(),
        })
    }) {
        Ok(result) => SyncRunOutcome::Completed(result),
        Err(failure) => SyncRunOutcome::Failed {
            failure,
            partial: Some(run.partial(now)),
        },
    };
    let span = tracing::Span::current();
    match &outcome {
        SyncRunOutcome::Completed(result) => {
            span.record("bytes", result.bytes);
            span.record("outcome", "completed");
        }
        SyncRunOutcome::Failed { failure, partial } => {
            if let Some(partial) = partial {
                span.record("bytes", partial.bytes);
            }
            span.record("outcome", "failed");
            if *failure != SyncFailure::Aborted {
                tracing::warn!(?failure, "graphql cache sync run failed");
            }
        }
    }
    outcome
}

/// How a run reaches the network.
#[derive(Clone, Copy)]
struct Stream<'a> {
    opener: &'a dyn SyncStreamOpener,
    read_ahead_bytes: usize,
    publish_interval: Duration,
    stall_timeout: Duration,
    cancel: &'a CancellationToken,
}

/// Merges hydrated pages into one publication per interval. Dropping it
/// publishes what is pending, so every exit reports the pages it wrote.
struct Coalesced<P: Fn(SyncPublication)> {
    publish: P,
    interval: Duration,
    pending: Option<(WriteResultWire, BTreeSet<String>)>,
    last: Option<Instant>,
}

impl<P: Fn(SyncPublication)> Coalesced<P> {
    fn push(&mut self, publication: SyncPublication) {
        match publication {
            SyncPublication::Hydrated {
                write,
                search_changed_buckets,
            } if !write.reset => {
                match &mut self.pending {
                    Some((pending, buckets)) => {
                        pending.revision_advanced |= write.revision_advanced;
                        pending.revision = write.revision;
                        buckets.extend(search_changed_buckets);
                    }
                    None => self.pending = Some((write, search_changed_buckets)),
                }
                if self.last.is_none_or(|last| last.elapsed() >= self.interval) {
                    self.flush();
                }
            }
            other => {
                self.flush();
                (self.publish)(other);
            }
        }
    }

    fn flush(&mut self) {
        if let Some((write, search_changed_buckets)) = self.pending.take() {
            (self.publish)(SyncPublication::Hydrated {
                write,
                search_changed_buckets,
            });
            self.last = Some(Instant::now());
        }
    }
}

impl<P: Fn(SyncPublication)> Drop for Coalesced<P> {
    fn drop(&mut self) {
        self.flush();
    }
}

/// Body bytes the reader task handed over, holding their share of the
/// read-ahead budget until every frame they complete is applied.
struct ReadChunk {
    bytes: Vec<u8>,
    _budget: OwnedSemaphorePermit,
}

/// Sends the request, then applies every frame while a reader task keeps
/// reading the body into a byte-bounded buffer. Each frame is one engine
/// write taken under the engine lock, so webview commands still go between
/// pages. On every exit the reader stops and the body is dropped, which
/// closes the connection; saved lane state only ever reflects applied pages.
async fn read_stream(
    engine: &WeakEngineHandle,
    stream: Stream<'_>,
    args: &SyncStartArgs,
    run: &mut SyncRun,
    hooks: &NativeSyncHooks,
    publish: impl Fn(SyncPublication),
) -> Result<(), SyncFailure> {
    let Stream {
        opener,
        read_ahead_bytes,
        publish_interval,
        stall_timeout,
        cancel,
    } = stream;
    let mut headers = args
        .headers
        .iter()
        .filter(|(name, _)| {
            ![CONTENT_TYPE, ACCEPT, ACCEPT_ENCODING]
                .iter()
                .any(|own| name.eq_ignore_ascii_case(own))
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect::<Vec<_>>();
    headers.push((CONTENT_TYPE.to_owned(), "application/json".to_owned()));
    headers.push((ACCEPT.to_owned(), NDJSON.to_owned()));
    headers.push((ACCEPT_ENCODING.to_owned(), GZIP.to_owned()));
    let request = SyncHttpRequest {
        url: args.url.clone(),
        headers,
        body: run.request_body().to_string().into_bytes(),
    };
    let response = cancel
        .run_until_cancelled(tokio::time::timeout(stall_timeout, opener.open(request)))
        .await
        .ok_or(SyncFailure::Aborted)?
        .map_err(|_| SyncFailure::Stalled)?
        .map_err(stream_failure)?;
    if !(200..300).contains(&response.status) {
        return Err(SyncFailure::Http {
            status: response.status,
        });
    }
    let decoder = BodyDecoder::new(response.content_encoding.as_deref())?;
    let reader_cancel = cancel.child_token();
    let (chunks_tx, mut chunks) = mpsc::unbounded_channel();
    let reader = tauri::async_runtime::spawn(read_ahead(
        response.body,
        decoder,
        Arc::new(Semaphore::new(read_ahead_bytes.max(1))),
        read_ahead_bytes.max(1),
        stall_timeout,
        reader_cancel.clone(),
        chunks_tx,
    ));
    // Owns `publish` and the channel, so nothing borrowed is held across writes.
    let applied = async move {
        let mut publish = Coalesced {
            publish,
            interval: publish_interval,
            pending: None,
            last: None,
        };
        while let Some(chunk) = cancel
            .run_until_cancelled(chunks.recv())
            .await
            .ok_or(SyncFailure::Aborted)?
        {
            let chunk: ReadChunk = chunk?;
            run.push_bytes(&chunk.bytes)
                .map_err(|error| SyncFailure::Stream {
                    message: error.to_string(),
                })?;
            while run.pending_frames() > 0 {
                // A write is never interrupted; a stop takes effect between frames.
                if cancel.is_cancelled() {
                    return Err(SyncFailure::Aborted);
                }
                if let Some(publication) = engine.sync_apply_next(run, hooks).await? {
                    publish.push(publication);
                }
            }
            // Dropping the chunk returns its budget: the reader may read on.
        }
        // A stop also ends the reader, whose closed channel must not read as
        // the end of the body.
        if cancel.is_cancelled() {
            return Err(SyncFailure::Aborted);
        }
        Ok(())
    }
    .await;
    // Close the connection before reporting, so the server stops running pages.
    reader_cancel.cancel();
    let _ = reader.await;
    applied
}

/// Decodes the body's content encoding as it streams.
enum BodyDecoder {
    Identity,
    Gzip(flate2::write::GzDecoder<Vec<u8>>),
}

impl BodyDecoder {
    fn new(content_encoding: Option<&str>) -> Result<Self, SyncFailure> {
        match content_encoding.map(str::trim) {
            None | Some("") => Ok(Self::Identity),
            Some(encoding) if encoding.eq_ignore_ascii_case("identity") => Ok(Self::Identity),
            Some(encoding) if encoding.eq_ignore_ascii_case(GZIP) => {
                Ok(Self::Gzip(flate2::write::GzDecoder::new(Vec::new())))
            }
            Some(encoding) => Err(SyncFailure::Stream {
                message: format!("unsupported content-encoding `{encoding}`"),
            }),
        }
    }

    /// Decoded bytes for one received chunk (possibly none yet).
    fn decode(&mut self, bytes: Vec<u8>) -> Result<Vec<u8>, SyncFailure> {
        match self {
            Self::Identity => Ok(bytes),
            Self::Gzip(decoder) => {
                use std::io::Write as _;
                decoder.write_all(&bytes).map_err(invalid_gzip)?;
                // flate2 keeps the last write's output (up to 32 KiB) in its
                // own buffer until the next write; flush hands it over now, so
                // a frame is not held back until the server sends more.
                decoder.flush().map_err(invalid_gzip)?;
                Ok(std::mem::take(decoder.get_mut()))
            }
        }
    }

    /// What remains once the body ended; fails on a truncated gzip body.
    fn finish(&mut self) -> Result<Vec<u8>, SyncFailure> {
        match self {
            Self::Identity => Ok(Vec::new()),
            Self::Gzip(decoder) => {
                decoder.try_finish().map_err(invalid_gzip)?;
                Ok(std::mem::take(decoder.get_mut()))
            }
        }
    }
}

fn invalid_gzip(error: std::io::Error) -> SyncFailure {
    SyncFailure::Stream {
        message: format!("invalid gzip body: {error}"),
    }
}

/// Reads and decodes the body until it ends, fails, sends nothing for
/// `stall_timeout` while it is being read, or the run stops, acquiring each
/// decoded chunk's size from `budget` (at most the whole budget, so one chunk
/// larger than the cap still passes). The budget therefore bounds unapplied
/// decoded bytes to the cap plus the one chunk read while waiting for room.
async fn read_ahead(
    mut body: Box<dyn SyncResponseBody>,
    mut decoder: BodyDecoder,
    budget: Arc<Semaphore>,
    capacity: usize,
    stall_timeout: Duration,
    cancel: CancellationToken,
    chunks: mpsc::UnboundedSender<Result<ReadChunk, SyncFailure>>,
) {
    loop {
        // Only a read counts as silence: waiting for room below is the
        // cache's wait.
        let read = tokio::time::timeout(stall_timeout, body.next_chunk());
        let received = match cancel.run_until_cancelled(read).await {
            None => return,
            Some(Err(_)) => {
                let _ = chunks.send(Err(SyncFailure::Stalled));
                return;
            }
            Some(Ok(received)) => received,
        };
        let received = match received {
            Ok(None) => match decoder.finish() {
                Ok(rest) if rest.is_empty() => return,
                Ok(rest) => (rest, true),
                Err(failure) => {
                    let _ = chunks.send(Err(failure));
                    return;
                }
            },
            Err(error) => {
                let _ = chunks.send(Err(stream_failure(error)));
                return;
            }
            Ok(Some(bytes)) => match decoder.decode(bytes) {
                Ok(decoded) => (decoded, false),
                Err(failure) => {
                    let _ = chunks.send(Err(failure));
                    return;
                }
            },
        };
        let (bytes, last) = received;
        if bytes.is_empty() {
            continue;
        }
        let size = u32::try_from(bytes.len().clamp(1, capacity)).unwrap_or(u32::MAX);
        let Some(Ok(permit)) = cancel
            .run_until_cancelled(Arc::clone(&budget).acquire_many_owned(size))
            .await
        else {
            return;
        };
        if chunks
            .send(Ok(ReadChunk {
                bytes,
                _budget: permit,
            }))
            .is_err()
            || last
        {
            return;
        }
    }
}

fn stream_failure(error: SyncHttpError) -> SyncFailure {
    SyncFailure::Stream { message: error.0 }
}
