//! Per-conversation work queues that survive restarts.
//!
//! [`ConversationQueue::push`] appends an item to `<dir>/<conversation>.jsonl`
//! and makes sure one worker runs for that conversation. The worker renames
//! the file to `<conversation>.batch`, hands every item in it to the handler
//! at once (a burst becomes one turn), deletes the batch when the handler
//! succeeds, and loops until the queue is empty. Different conversations run
//! in parallel; one conversation never runs two batches at once.
//!
//! A crash mid-turn leaves the `.batch` file behind; [`ConversationQueue::resume`]
//! at startup runs it again before anything newer. A failed batch moves to
//! `<dir>/failed/` so it is neither lost nor retried forever.

use std::collections::HashSet;
use std::future::Future;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures::future::BoxFuture;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use crate::error::{Error, Result};
use crate::memory::{append_jsonl, file_safe, list_dir, read_jsonl};

#[cfg(test)]
mod test;

const QUEUE_EXT: &str = "jsonl";
const BATCH_EXT: &str = "batch";

type Handler<T> = Arc<dyn Fn(String, Vec<T>) -> BoxFuture<'static, Result<()>> + Send + Sync>;

/// Durable per-conversation queues, each drained by at most one worker.
pub struct ConversationQueue<T> {
    inner: Arc<Inner<T>>,
}

impl<T> Clone for ConversationQueue<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

struct Inner<T> {
    dir: PathBuf,
    active: tokio::sync::Mutex<HashSet<String>>,
    handler: Handler<T>,
    cancel: CancellationToken,
    tracker: TaskTracker,
    _items: PhantomData<fn() -> T>,
}

impl<T> ConversationQueue<T>
where
    T: Serialize + DeserializeOwned + Send + 'static,
{
    /// Queues stored under `dir`, drained by `handler(conversation, batch)`.
    ///
    /// The conversation passed to the handler is the file-safe form of the
    /// key given to [`push`](Self::push) (identical for UUIDs). Workers stop
    /// taking new batches once `cancel` fires; a batch already running is
    /// left to finish (the handler can watch the token itself).
    pub fn new<F, Fut>(dir: impl Into<PathBuf>, cancel: CancellationToken, handler: F) -> Self
    where
        F: Fn(String, Vec<T>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        let handler: Handler<T> =
            Arc::new(move |conversation, batch| Box::pin(handler(conversation, batch)));
        Self {
            inner: Arc::new(Inner {
                dir: dir.into(),
                active: tokio::sync::Mutex::new(HashSet::new()),
                handler,
                cancel,
                tracker: TaskTracker::new(),
                _items: PhantomData,
            }),
        }
    }

    /// Add an item to a conversation's queue and start its worker if idle.
    pub async fn push(&self, conversation: &str, item: &T) -> Result<()> {
        let key = file_safe(conversation);
        let mut active = self.inner.active.lock().await;
        append_jsonl(&self.inner.path(&key, QUEUE_EXT), item).await?;
        self.start_locked(&mut active, key);
        Ok(())
    }

    /// Start workers for every conversation with work left on disk (queued
    /// items or a batch interrupted by a crash). Call once at startup.
    /// Returns how many conversations it started.
    pub async fn resume(&self) -> Result<usize> {
        let mut active = self.inner.active.lock().await;
        let mut started = 0;
        for path in list_dir(&self.inner.dir).await? {
            let is_work = path
                .extension()
                .is_some_and(|e| e == QUEUE_EXT || e == BATCH_EXT);
            let Some(key) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if is_work && !active.contains(key) {
                self.start_locked(&mut active, key.to_owned());
                started += 1;
            }
        }
        Ok(started)
    }

    /// Items waiting for a conversation, including a batch in progress.
    pub async fn pending(&self, conversation: &str) -> Result<Vec<T>> {
        let key = file_safe(conversation);
        let _guard = self.inner.active.lock().await;
        let mut items = read_jsonl(&self.inner.path(&key, BATCH_EXT)).await?;
        items.extend(read_jsonl(&self.inner.path(&key, QUEUE_EXT)).await?);
        Ok(items)
    }

    /// Stop accepting worker starts and wait for running batches to finish.
    pub async fn shutdown(&self) {
        self.inner.tracker.close();
        self.inner.tracker.wait().await;
    }

    fn start_locked(&self, active: &mut HashSet<String>, key: String) {
        if self.inner.cancel.is_cancelled() || !active.insert(key.clone()) {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let span = tracing::info_span!("agent_brain.queue.worker", conversation = %key);
        self.inner
            .tracker
            .spawn(async move { inner.drain(key).await }.instrument(span));
    }
}

impl<T> Inner<T>
where
    T: Serialize + DeserializeOwned + Send + 'static,
{
    fn path(&self, key: &str, ext: &str) -> PathBuf {
        self.dir.join(format!("{key}.{ext}"))
    }

    async fn drain(&self, key: String) {
        loop {
            let batch = {
                let mut active = self.active.lock().await;
                let taken = if self.cancel.is_cancelled() {
                    Ok(None)
                } else {
                    self.take_batch(&key).await
                };
                match taken {
                    Ok(Some(batch)) => batch,
                    Ok(None) => {
                        active.remove(&key);
                        return;
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "could not take a batch; worker stopping");
                        active.remove(&key);
                        return;
                    }
                }
            };
            let size = batch.len();
            let batch_path = self.path(&key, BATCH_EXT);
            let span =
                tracing::info_span!("agent_brain.queue.batch", conversation = %key, items = size);
            let result = (self.handler)(key.clone(), batch).instrument(span).await;
            let settled = match result {
                Ok(()) => tokio::fs::remove_file(&batch_path)
                    .await
                    .map_err(|e| Error::io("delete", &batch_path, e)),
                Err(e) => {
                    tracing::warn!(error = %e, items = size, "batch failed; moving it to failed/");
                    self.set_aside(&key, &batch_path).await
                }
            };
            if let Err(e) = settled {
                // Leaving the batch in place would rerun it forever.
                tracing::error!(error = %e, "could not settle a batch; worker stopping");
                self.active.lock().await.remove(&key);
                return;
            }
        }
    }

    /// The interrupted batch if one exists, else the queued items renamed
    /// into a new batch; `None` when there is nothing to do.
    async fn take_batch(&self, key: &str) -> Result<Option<Vec<T>>> {
        let batch_path = self.path(key, BATCH_EXT);
        loop {
            if !exists(&batch_path).await? {
                let queue_path = self.path(key, QUEUE_EXT);
                if !exists(&queue_path).await? {
                    return Ok(None);
                }
                tokio::fs::rename(&queue_path, &batch_path)
                    .await
                    .map_err(|e| Error::io("take", &queue_path, e))?;
            }
            let items = read_jsonl(&batch_path).await?;
            if !items.is_empty() {
                return Ok(Some(items));
            }
            tokio::fs::remove_file(&batch_path)
                .await
                .map_err(|e| Error::io("delete", &batch_path, e))?;
        }
    }

    async fn set_aside(&self, key: &str, batch_path: &Path) -> Result<()> {
        let failed_dir = self.dir.join("failed");
        tokio::fs::create_dir_all(&failed_dir)
            .await
            .map_err(|e| Error::io("create", &failed_dir, e))?;
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
        let target = failed_dir.join(format!("{key}-{stamp}.jsonl"));
        tokio::fs::rename(batch_path, &target)
            .await
            .map_err(|e| Error::io("move", batch_path, e))
    }
}

async fn exists(path: &Path) -> Result<bool> {
    tokio::fs::try_exists(path)
        .await
        .map_err(|e| Error::io("inspect", path, e))
}
