#![deny(missing_docs)]
//! Lets concurrent callers that ask for the same thing share one piece of work.
//!
//! A [`SingleFlight`] keeps the work that is running right now, by key. A
//! caller whose key is already running waits for that run and receives a clone
//! of its output instead of starting a second one. Nothing is kept once the
//! work finishes: the next caller starts a new run, so this adds no cache
//! lifetime of its own. It is per process.
//!
//! The work belongs to every caller waiting on it, not to the one that started
//! it. Whichever caller is polled drives it, so it keeps running when the
//! caller that started it is cancelled, and it is dropped only when the last
//! waiting caller goes away. An error is an output like any other: every
//! waiting caller receives it and the next caller starts again.

use std::{
    collections::HashMap,
    hash::Hash,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
};

use futures::{
    FutureExt,
    future::{BoxFuture, Shared, WeakShared},
};
use tracing::Instrument;

#[cfg(test)]
mod test;

/// Span field [`SingleFlight::run`] records on the caller's span: `true` when
/// the caller waited on work another caller started, `false` when it started
/// the work. Declare it as `tracing::field::Empty` to have it recorded.
pub const COALESCED_FIELD: &str = "coalesced";

type Running<K, T> = Arc<Mutex<HashMap<K, Run<T>>>>;

struct Run<T> {
    id: u64,
    work: WeakShared<BoxFuture<'static, T>>,
}

/// The work running right now, by key. See the [crate docs](crate).
pub struct SingleFlight<K, T> {
    running: Running<K, T>,
    next_id: AtomicU64,
}

impl<K, T> Default for SingleFlight<K, T> {
    fn default() -> Self {
        Self {
            running: Arc::default(),
            next_id: AtomicU64::new(0),
        }
    }
}

impl<K, T> SingleFlight<K, T>
where
    K: Eq + Hash + Clone + Send + 'static,
    T: Clone + Send + Sync + 'static,
{
    /// An empty set of running work.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the output of `work`, or of the work already running for `key`.
    ///
    /// `work` is dropped unpolled when the caller joins a run. The key must
    /// name everything the output depends on: callers with equal keys receive
    /// the same output.
    pub async fn run<F>(&self, key: K, work: F) -> T
    where
        F: Future<Output = T> + Send + 'static,
    {
        let (work, coalesced) = self.join_or_start(key, work);
        tracing::Span::current().record(COALESCED_FIELD, coalesced);

        work.await
    }

    fn join_or_start<F>(&self, key: K, work: F) -> (Shared<BoxFuture<'static, T>>, bool)
    where
        F: Future<Output = T> + Send + 'static,
    {
        let mut running = lock(&self.running);

        if let Some(work) = running.get(&key).and_then(|run| run.work.upgrade()) {
            return (work, true);
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let finished = Finished {
            running: Arc::clone(&self.running),
            key: key.clone(),
            id,
        };
        let work = async move {
            let _finished = finished;
            work.await
        }
        .in_current_span()
        .boxed()
        .shared();

        if let Some(weak) = work.downgrade() {
            running.insert(key, Run { id, work: weak });
        }

        (work, false)
    }
}

/// Forgets a run when its work completes or is dropped, so a later caller
/// never joins work that can no longer make progress. A run abandoned by all
/// its callers may already have been replaced under the same key; the id keeps
/// it from removing its replacement.
struct Finished<K: Eq + Hash, T> {
    running: Running<K, T>,
    key: K,
    id: u64,
}

impl<K: Eq + Hash, T> Drop for Finished<K, T> {
    fn drop(&mut self) {
        let mut running = lock(&self.running);

        if running.get(&self.key).is_some_and(|run| run.id == self.id) {
            running.remove(&self.key);
        }
    }
}

fn lock<K, T>(running: &Running<K, T>) -> MutexGuard<'_, HashMap<K, Run<T>>> {
    running.lock().unwrap_or_else(PoisonError::into_inner)
}
