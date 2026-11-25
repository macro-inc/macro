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
//! waiting caller goes away, unless it was started with
//! [`SingleFlight::run_to_completion`], which keeps it running to its end. An
//! error is an output like any other: every waiting caller receives it and the
//! next caller starts again. If the work panics, the panic stays with the
//! caller that was driving it and every other waiting caller runs the work for
//! itself.

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
    future::{self, BoxFuture, Either, Shared, WeakShared, select},
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

/// Who drives a run's work: its callers, or a task they wait on.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Driver {
    Callers,
    Task,
}

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
        self.run_with(key, work, Driver::Callers).await
    }

    /// Like [`run`](Self::run), but the work also runs to its end when every
    /// caller goes away, and a caller arriving before then joins it. A task on
    /// the current Tokio runtime drives the work, and callers wait for its
    /// output.
    ///
    /// For work whose effects outlast the call, such as a lookup that leaves
    /// what it read for the next one: when its callers give up (a search
    /// cancelled because the user kept typing), the next caller would
    /// otherwise start over. A panic in the task reaches no caller; the
    /// waiting ones run the work themselves, as when a caller's poll panics.
    pub async fn run_to_completion<F, Fut>(&self, key: K, work: F) -> T
    where
        F: Fn() -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        self.run_with(key, work, Driver::Task).await
    }

    async fn run_with<F, Fut>(&self, key: K, work: F, driver: Driver) -> T
    where
        F: Fn() -> Fut,
        Fut: Future<Output = T> + Send + 'static,
    {
        let (shared, panicked, coalesced) = self.join_or_start(key, &work, driver);
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
        driver: Driver,
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

        // The work is made before its run's guard exists: a guard dropped by a
        // panic here would lock the registry this function holds.
        let work = Box::pin(work());
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (signal_panic, panicked) = oneshot::channel();
        let panicked = panicked.shared();
        let finished = Finished {
            running: Arc::clone(&self.running),
            key: key.clone(),
            id,
        };
        let (shared, task) = match driver {
            Driver::Callers => {
                let shared = SharedWork {
                    work,
                    signal_panic: Some(signal_panic),
                    finished: Some(finished),
                }
                .in_current_span()
                .boxed()
                .shared();
                (shared, None)
            }
            Driver::Task => {
                let (shared, task) = drive_with_task(work, signal_panic, finished);
                (shared, Some(task))
            }
        };

        if let Some(weak) = shared.downgrade() {
            let run = Run {
                id,
                work: weak,
                panicked: panicked.clone(),
                started_by: tracing::Span::current(),
            };
            running.insert(key, run);
        }

        // Spawned once the registry is unlocked, for the same reason: spawning
        // panics outside a runtime, and the dropped task's guard locks it.
        drop(running);
        if let Some(task) = task {
            tokio::spawn(task);
        }

        (shared, panicked, false)
    }
}

/// What the callers of `work` wait on, the output the task delivers, and the
/// task that drives `work`, for the caller to spawn. Only the task polls the
/// work. A caller
/// polling it too could find it poisoned by a panic on the task's thread
/// between checking the panic signal and polling, and panic instead of running
/// the work itself.
///
/// The task holds a clone of what callers wait on, which keeps the run
/// joinable while no caller waits. When it ends without delivering, because the
/// work panicked or the task was dropped, it signals the panic, so the waiting
/// callers run the work themselves.
fn drive_with_task<K, T>(
    work: BoxFuture<'static, T>,
    signal_panic: oneshot::Sender<()>,
    finished: Finished<K, T>,
) -> (Shared<BoxFuture<'static, T>>, BoxFuture<'static, ()>)
where
    K: Eq + Hash + Send + 'static,
    T: Clone + Send + Sync + 'static,
{
    let (deliver, delivered) = oneshot::channel();
    let shared = async move {
        match delivered.await {
            Ok(output) => output,
            // Undelivered output comes with the panic signal, which callers
            // poll first and act on.
            Err(oneshot::Canceled) => future::pending().await,
        }
    }
    .boxed()
    .shared();

    let driven = SharedWork {
        work,
        signal_panic: None,
        finished: Some(finished),
    }
    .in_current_span();
    let joinable = shared.clone();
    let undelivered = SignalUnlessDelivered(Some(signal_panic));

    let task = async move {
        let output = driven.await;
        // Fails only when no caller is waiting, which needs no output.
        let _ = deliver.send(output);
        undelivered.delivered();
        drop(joinable);
    }
    .boxed();

    (shared, task)
}

/// Signals the panic when dropped, unless the output was delivered first.
struct SignalUnlessDelivered(Option<oneshot::Sender<()>>);

impl SignalUnlessDelivered {
    fn delivered(mut self) {
        self.0 = None;
    }
}

impl Drop for SignalUnlessDelivered {
    fn drop(&mut self) {
        if let Some(signal_panic) = self.0.take() {
            // Fails only when no caller is waiting, which needs no signal.
            let _ = signal_panic.send(());
        }
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
