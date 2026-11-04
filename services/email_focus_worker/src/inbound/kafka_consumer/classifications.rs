//! The classifications in flight: a bounded number at once, one per thread.

use std::{
    collections::{HashMap, hash_map::Entry},
    future::Future,
};

use tokio::sync::mpsc;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Runs classifications side by side so a slow one holds up nothing but its
/// own thread. Mail for a thread being classified doesn't start a second call:
/// the newest such event runs once the current one ends, and classifying again
/// costs nothing if the first call already saw that mail.
pub struct Classifications<F> {
    capacity: usize,
    /// Threads being classified, each with what to run next if more mail came.
    running: HashMap<Uuid, Option<F>>,
    finished_tx: mpsc::UnboundedSender<Uuid>,
    finished_rx: mpsc::UnboundedReceiver<Uuid>,
    tracker: TaskTracker,
    cancel: CancellationToken,
}

/// Reports a thread's task as finished however it ends, a panic included, so
/// one bad classification can't keep its slot forever.
struct FinishedOnDrop {
    thread_id: Uuid,
    finished: mpsc::UnboundedSender<Uuid>,
}

impl Drop for FinishedOnDrop {
    fn drop(&mut self) {
        // The receiver is only gone once the worker is shutting down.
        let _ = self.finished.send(self.thread_id);
    }
}

impl<F> Classifications<F>
where
    F: Future<Output = ()> + Send + 'static,
{
    /// Allow `capacity` threads to be classified at once.
    pub fn new(capacity: usize) -> Self {
        let (finished_tx, finished_rx) = mpsc::unbounded_channel();
        Self {
            capacity,
            running: HashMap::new(),
            finished_tx,
            finished_rx,
            tracker: TaskTracker::new(),
            cancel: CancellationToken::new(),
        }
    }

    /// Whether another thread can start. Wait with [`Self::next_finished`] until
    /// it can, so the Kafka consumer stops reading instead of queueing here.
    pub fn has_room(&self) -> bool {
        self.running.len() < self.capacity
    }

    /// Run `classification` for `thread_id`, or after the one running for it.
    pub fn submit(&mut self, thread_id: Uuid, classification: F) {
        match self.running.entry(thread_id) {
            Entry::Occupied(mut running) => {
                running.insert(Some(classification));
            }
            Entry::Vacant(slot) => {
                slot.insert(None);
                self.start(thread_id, classification);
            }
        }
    }

    fn start(&self, thread_id: Uuid, classification: F) {
        let finished = FinishedOnDrop {
            thread_id,
            finished: self.finished_tx.clone(),
        };
        let cancel = self.cancel.clone();
        self.tracker.spawn(async move {
            let _finished = finished;
            cancel.run_until_cancelled(classification).await;
        });
    }

    /// Wait for a classification to end and free its slot, unless its thread
    /// has another waiting, which then takes the slot. Safe to cancel.
    pub async fn next_finished(&mut self) {
        let Some(thread_id) = self.finished_rx.recv().await else {
            return;
        };
        if let Some(next) = self.running.remove(&thread_id).flatten() {
            self.running.insert(thread_id, None);
            self.start(thread_id, next);
        }
    }

    /// Drop everything in flight and wait for its tasks to end.
    pub async fn shutdown(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}
