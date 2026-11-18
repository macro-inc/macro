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
//! waiting caller receives it and the next caller starts again. If the work
//! panics, the panic stays with the caller that was driving it and every other
//! waiting caller runs the work for itself.

use std::{
    collections::HashMap,
    hash::Hash,
    pin::Pin,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    task::{Context, Poll},
};

use futures::{
    FutureExt,
    channel::oneshot,
    future::{BoxFuture, Either, Shared, WeakShared, select},
};
use tracing::Instrument;

mod database_key;
pub use database_key::DatabaseKey;

#[cfg(test)]
mod test;

/// Span field [`SingleFlight::run`] records on the caller's span: `true` when
/// the caller waited on work another caller started, `false` when it started
/// the work. Declare it as `tracing::field::Empty` to have it recorded.
pub const COALESCED_FIELD: &str = "coalesced";

type Runs<K, T> = Arc<Mutex<HashMap<K, Run<T>>>>;
type Panicked = Shared<oneshot::Receiver<()>>;

struct Run<T> {
    id: u64,
    work: WeakShared<BoxFuture<'static, T>>,
    panicked: Panicked,
    started_by: tracing::Span,
}

/// The work running right now, by key. See the [crate docs](crate).
pub struct SingleFlight<K, T> {
    running: Runs<K, T>,
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
    /// `work` is not called when the caller joins a run, unless that run
    /// panics. The key must name everything the output depends on: callers
    /// with equal keys receive the same output.
    pub async fn run<F, Fut>(&self, key: K, work: F) -> T
    where
        F: Fn() -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        let (shared, panicked, coalesced) = self.join_or_start(key, &work);
        tracing::Span::current().record(COALESCED_FIELD, coalesced);

        // The panic signal is polled first: polling work that has panicked
        // panics again. A dropped signal means the work finished or is about
        // to, so its output is there to wait for.
        match select(panicked, shared).await {
            Either::Left((Ok(()), _shared)) => work().await,
            Either::Left((Err(oneshot::Canceled), shared)) => shared.await,
            Either::Right((output, _panicked)) => output,
        }
    }

    fn join_or_start<F, Fut>(
        &self,
        key: K,
        work: &F,
    ) -> (Shared<BoxFuture<'static, T>>, Panicked, bool)
    where
        F: Fn() -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        let mut running = lock(&self.running);

        if let Some(run) = running.get(&key)
            && let Some(shared) = run.work.upgrade()
        {
            tracing::Span::current().follows_from(&run.started_by);
            return (shared, run.panicked.clone(), true);
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (signal_panic, panicked) = oneshot::channel();
        let panicked = panicked.shared();
        let shared = SharedWork {
            work: Box::pin(work()),
            signal_panic: Some(signal_panic),
            finished: Some(Finished {
                running: Arc::clone(&self.running),
                key: key.clone(),
                id,
            }),
        }
        .in_current_span()
        .boxed()
        .shared();

        if let Some(weak) = shared.downgrade() {
            let run = Run {
                id,
                work: weak,
                panicked: panicked.clone(),
                started_by: tracing::Span::current(),
            };
            running.insert(key, run);
        }

        (shared, panicked, false)
    }
}

/// The shared work. It forgets its run when it completes or is dropped, and
/// when a poll panics it also tells the waiting callers, who would otherwise
/// wait on work nobody can drive any more.
struct SharedWork<K: Eq + Hash, T> {
    work: BoxFuture<'static, T>,
    signal_panic: Option<oneshot::Sender<()>>,
    finished: Option<Finished<K, T>>,
}

// Nothing in `SharedWork` is structurally pinned: the work is already boxed.
impl<K: Eq + Hash, T> Unpin for SharedWork<K, T> {}

impl<K: Eq + Hash, T> Future for SharedWork<K, T> {
    type Output = T;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<T> {
        let this = &mut *self;
        let poll = PollInProgress {
            signal_panic: &mut this.signal_panic,
            finished: &mut this.finished,
        };
        let output = this.work.as_mut().poll(context);
        std::mem::forget(poll);

        if output.is_ready() {
            this.finished = None;
        }

        output
    }
}

/// Dropped only when the poll it guards unwinds.
struct PollInProgress<'a, K: Eq + Hash, T> {
    signal_panic: &'a mut Option<oneshot::Sender<()>>,
    finished: &'a mut Option<Finished<K, T>>,
}

impl<K: Eq + Hash, T> Drop for PollInProgress<'_, K, T> {
    fn drop(&mut self) {
        *self.finished = None;

        if let Some(signal_panic) = self.signal_panic.take() {
            // Fails only when no caller is waiting, which needs no signal.
            let _ = signal_panic.send(());
        }
    }
}

/// Forgets a run when dropped, so a later caller never joins work that has
/// finished or can no longer make progress. A run abandoned by all its callers
/// may already have been replaced under the same key; the id keeps it from
/// removing its replacement.
struct Finished<K: Eq + Hash, T> {
    running: Runs<K, T>,
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

fn lock<K, T>(running: &Runs<K, T>) -> MutexGuard<'_, HashMap<K, Run<T>>> {
    running.lock().unwrap_or_else(PoisonError::into_inner)
}
