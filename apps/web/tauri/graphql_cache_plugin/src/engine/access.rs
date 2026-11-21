//! Foreground commands retain FIFO order; cache warming never reserves a turn
//! ahead of them. Superseded warming must be fetched again, not replayed after
//! the authoritative write that overtook it.
//!
//! Every command but a read takes a turn, in order, before the engine. A
//! hydrate may give up the engine between computing its write and writing it
//! while keeping its turn ([`AccessGuard::yield_to_reads`]): reads run, and
//! nothing else does. A read that arrives after a command still waiting for
//! its turn takes a turn too, so a read never overtakes an earlier command.
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, MutexGuard, Notify};

pub(super) struct EngineAccess<T> {
    value: Mutex<T>,
    /// Held by every command but a read, for as long as it runs.
    turn: Mutex<()>,
    /// Commands waiting for their turn or, holding it, for the engine.
    turn_waiting: AtomicUsize,
    available: Notify,
    write_epoch: AtomicU64,
    /// Hydrates waiting for the engine. They wait on `available`, not in the
    /// mutex queue, so idle work checks this instead.
    hydrates_waiting: AtomicUsize,
    quiet: Quiet,
}

impl<T> EngineAccess<T> {
    pub(super) fn new(value: T) -> Self {
        Self {
            value: Mutex::new(value),
            turn: Mutex::new(()),
            turn_waiting: AtomicUsize::new(0),
            available: Notify::new(),
            write_epoch: AtomicU64::new(0),
            hydrates_waiting: AtomicUsize::new(0),
            quiet: Quiet::default(),
        }
    }

    /// Calls `start` after a release when no idle task is armed, with the
    /// release count then. The task it starts waits for
    /// [`Self::quiet_releases`] to stop changing, then takes the engine with
    /// [`Self::try_idle`]. It takes every strong reference through
    /// [`IdleHolds::hold`], so shutdown can wait for it.
    pub(super) fn on_quiet(&self, start: impl Fn(Arc<IdleHolds>, u64) + Send + Sync + 'static) {
        let _ = self.quiet.start.set(Box::new(start));
    }

    /// Counts guard releases, so an idle task can tell the engine was used.
    pub(super) fn quiet_releases(&self) -> u64 {
        self.quiet.releases.load(Ordering::SeqCst)
    }

    /// Takes the engine for idle work without waiting, or `None` when it is
    /// held, a command or hydrate is queued for it, or shutdown began. Either
    /// way the idle task is done: the next release starts another. Its own
    /// release wakes waiters but starts nothing.
    pub(super) fn try_idle(&self) -> Option<AccessGuard<'_, T>> {
        self.quiet.armed.store(false, Ordering::SeqCst);
        if self.quiet.closed.load(Ordering::SeqCst) {
            return None;
        }
        // The turn wakes waiters when it drops, also after a failed engine try:
        // a hydrate that found it held may have slept through the last
        // release. Idle work never waits for that wake, so it cannot spin on it.
        let turn = self.held(self.turn.try_lock().ok()?);
        let guard = AccessGuard {
            value: self.value.try_lock().ok()?,
            _turn: Some(turn),
            _release: ReleaseNotice {
                available: &self.available,
                quiet: None,
            },
        };
        // Checked once the engine is held: a hydrate that starts waiting
        // after this is woken by the guard's release. Dropping the guard here
        // wakes any hydrate already waiting.
        if self.hydrates_waiting.load(Ordering::SeqCst) > 0 {
            return None;
        }
        Some(guard)
    }

    /// Stops idle work for good, before the engine is closed.
    pub(super) fn close_quiet(&self) {
        self.quiet.closed.store(true, Ordering::SeqCst);
    }

    /// Whether idle work is done: none armed and none holding the engine.
    #[cfg(test)]
    pub(super) fn idle_settled(&self) -> bool {
        !self.quiet.armed.load(Ordering::SeqCst) && self.quiet.holds.open() == 0
    }

    fn held<'a>(&'a self, turn: MutexGuard<'a, ()>) -> Turn<'a> {
        Turn {
            _turn: turn,
            _wake: Wake(Some(&self.available)),
        }
    }

    fn release_notice(&self) -> ReleaseNotice<'_> {
        ReleaseNotice {
            available: &self.available,
            quiet: Some(&self.quiet),
        }
    }

    pub(super) fn into_inner(self) -> T {
        self.value.into_inner()
    }

    #[tracing::instrument(name = "graphql_cache.native.lock", skip_all, fields(graphql_cache.lock.kind = "foreground", graphql_cache.lock.wait_ms = tracing::field::Empty))]
    pub(super) async fn lock(&self) -> AccessGuard<'_, T> {
        let _wait = AcquisitionWait::new();
        let _waiting = Counted::new(&self.turn_waiting);
        let turn = self.held(wake_if_dropped(&self.available, self.turn.lock()).await);
        AccessGuard {
            value: self.value.lock().await,
            _turn: Some(turn),
            _release: self.release_notice(),
        }
    }

    /// Takes the engine for a command that only reads. It may run while a
    /// hydrate between its halves keeps its turn, unless a command that
    /// came first still waits, which it then follows.
    #[tracing::instrument(name = "graphql_cache.native.lock", skip_all, fields(graphql_cache.lock.kind = "read", graphql_cache.lock.wait_ms = tracing::field::Empty))]
    pub(super) async fn read(&self) -> AccessGuard<'_, T> {
        if self.turn_waiting.load(Ordering::SeqCst) > 0 {
            return self.lock().await;
        }
        let _wait = AcquisitionWait::new();
        AccessGuard {
            value: wake_if_dropped(&self.available, self.value.lock()).await,
            _turn: None,
            _release: self.release_notice(),
        }
    }

    pub(super) async fn write(&self) -> AccessGuard<'_, T> {
        self.write_epoch.fetch_add(1, Ordering::SeqCst);
        self.lock().await
    }

    #[tracing::instrument(name = "graphql_cache.native.lock", skip_all, fields(graphql_cache.lock.kind = "hydrate", graphql_cache.lock.wait_ms = tracing::field::Empty), err)]
    pub(super) async fn hydrate(&self) -> Result<AccessGuard<'_, T>, String> {
        let epoch = self.write_epoch.load(Ordering::SeqCst);
        let _waiting = Counted::new(&self.hydrates_waiting);
        let _wait = AcquisitionWait::new();
        // A hydrate that stops waiting, superseded or cancelled, may be the
        // one another found holding the turn: wake the rest.
        let mut gave_up = Wake(Some(&self.available));
        loop {
            // Register before trying the lock so a release cannot be lost.
            let notified = self.available.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if epoch != self.write_epoch.load(Ordering::SeqCst) {
                return Err(
                    "cache hydration superseded by a foreground write; refetch the page".into(),
                );
            }
            if let Ok(turn) = self.turn.try_lock() {
                // With the turn, only a read can hold the engine. Holding the
                // turn while it waits would put this hydrate ahead of commands
                // that queue meanwhile, so give the turn back, without a wake:
                // this hydrate's own registration would spin on it. The read's
                // release wakes it.
                if let Ok(value) = self.value.try_lock() {
                    let guard = AccessGuard {
                        value,
                        _turn: Some(self.held(turn)),
                        _release: self.release_notice(),
                    };
                    if epoch != self.write_epoch.load(Ordering::SeqCst) {
                        return Err(
                            "cache hydration superseded by a foreground write; refetch the page"
                                .into(),
                        );
                    }
                    gave_up.0 = None;
                    return Ok(guard);
                }
            }
            notified.await;
        }
    }
}

/// Counts a waiter until it returns, on every exit.
struct Counted<'a>(&'a AtomicUsize);
impl<'a> Counted<'a> {
    fn new(waiting: &'a AtomicUsize) -> Self {
        waiting.fetch_add(1, Ordering::SeqCst);
        Self(waiting)
    }
}
impl Drop for Counted<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

// Record queue time on every exit, including supersession and cancellation.
// The returned AccessGuard outlives this timer, so lock hold time is excluded.
struct AcquisitionWait {
    span: tracing::Span,
    started: std::time::Instant,
}
impl AcquisitionWait {
    fn new() -> Self {
        Self {
            span: tracing::Span::current(),
            started: std::time::Instant::now(),
        }
    }
}
impl Drop for AcquisitionWait {
    fn drop(&mut self) {
        self.span.record(
            "graphql_cache.lock.wait_ms",
            self.started.elapsed().as_secs_f64() * 1_000.0,
        );
    }
}

// Fields drop in declaration order: the engine, then the turn, then the
// release notice, so a woken waiter finds both free.
pub(super) struct AccessGuard<'a, T> {
    value: MutexGuard<'a, T>,
    _turn: Option<Turn<'a>>,
    _release: ReleaseNotice<'a>,
}

impl<'a, T> AccessGuard<'a, T> {
    /// Gives the engine to reads while keeping this command's turn, or
    /// `Err(self)` for a read's guard, which holds no turn.
    pub(super) fn yield_to_reads(
        self,
        access: &'a EngineAccess<T>,
    ) -> Result<HeldTurn<'a, T>, Self> {
        let AccessGuard {
            value,
            _turn: turn,
            _release,
        } = self;
        let Some(turn) = turn else {
            return Err(AccessGuard {
                value,
                _turn: None,
                _release,
            });
        };
        drop(value);
        Ok(HeldTurn {
            access,
            turn,
            _release,
        })
    }
}

/// A command's turn, kept while reads use the engine.
pub(super) struct HeldTurn<'a, T> {
    access: &'a EngineAccess<T>,
    turn: Turn<'a>,
    _release: ReleaseNotice<'a>,
}

impl<'a, T> HeldTurn<'a, T> {
    /// Takes the engine back, after the reads already waiting for it.
    pub(super) async fn resume(self) -> AccessGuard<'a, T> {
        let HeldTurn {
            access,
            turn,
            _release,
        } = self;
        AccessGuard {
            value: access.value.lock().await,
            _turn: Some(turn),
            _release,
        }
    }
}

impl<T> Deref for AccessGuard<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.value
    }
}
impl<T> DerefMut for AccessGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.value
    }
}
/// A held turn. Releasing it, even from a command cancelled while it waited
/// for the engine, wakes warming hydrates and idle work, which wait for
/// releases by notification rather than in the turn's queue.
struct Turn<'a> {
    _turn: MutexGuard<'a, ()>,
    _wake: Wake<'a>,
}
/// Wakes waiters on drop, unless disarmed.
struct Wake<'a>(Option<&'a Notify>);
impl Drop for Wake<'_> {
    fn drop(&mut self) {
        if let Some(available) = self.0 {
            available.notify_waiters();
        }
    }
}

/// Waits for a lock, waking waiters if dropped first: Tokio may already have
/// handed the lock to this waiter, and gives it back without a release
/// notice when the wait is cancelled. The awaited lock future is dropped
/// before `wake`, so a woken waiter finds the lock free.
async fn wake_if_dropped<G>(available: &Notify, lock: impl std::future::Future<Output = G>) -> G {
    let mut wake = Wake(Some(available));
    let guard = lock.await;
    wake.0 = None;
    guard
}

// Struct fields drop in declaration order: unlock before waking waiters.
struct ReleaseNotice<'a> {
    available: &'a Notify,
    /// Absent on an idle task's own guard, so idle work never restarts itself.
    quiet: Option<&'a Quiet>,
}
impl Drop for ReleaseNotice<'_> {
    fn drop(&mut self) {
        self.available.notify_waiters();
        if let Some(quiet) = self.quiet {
            quiet.released();
        }
    }
}

/// Starts an idle task with the holds it counts and the release count.
type StartIdle = dyn Fn(Arc<IdleHolds>, u64) + Send + Sync;

/// Idle work for the host to run once commands stop: at most one task armed
/// at a time, started by the first release after the last one finished.
#[derive(Default)]
struct Quiet {
    releases: AtomicU64,
    armed: AtomicBool,
    closed: AtomicBool,
    holds: Arc<IdleHolds>,
    start: OnceLock<Box<StartIdle>>,
}
impl Quiet {
    fn released(&self) {
        let releases = self.releases.fetch_add(1, Ordering::SeqCst) + 1;
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        if let Some(start) = self.start.get()
            && !self.armed.swap(true, Ordering::SeqCst)
        {
            start(Arc::clone(&self.holds), releases);
        }
    }
}

/// Counts the strong references idle work takes, so shutdown can tell a
/// brief idle hold from a command handle that keeps the engine.
#[derive(Default)]
pub(super) struct IdleHolds {
    started: AtomicU64,
    ended: AtomicU64,
}

impl IdleHolds {
    /// Upgrades `weak` for idle work. The hold counts as open until it drops.
    pub(super) fn hold<T>(self: &Arc<Self>, weak: &Weak<T>) -> Option<IdleHold<T>> {
        self.started.fetch_add(1, Ordering::SeqCst);
        let end = HoldEnd(Arc::clone(self));
        weak.upgrade().map(|value| IdleHold { value, _end: end })
    }

    fn open(&self) -> u64 {
        let ended = self.ended.load(Ordering::SeqCst);
        self.started.load(Ordering::SeqCst).saturating_sub(ended)
    }
}

/// A strong reference idle work holds.
pub(super) struct IdleHold<T> {
    // Fields drop in declaration order: the reference goes before the count.
    value: Arc<T>,
    _end: HoldEnd,
}
impl<T> Deref for IdleHold<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.value
    }
}
struct HoldEnd(Arc<IdleHolds>);
impl Drop for HoldEnd {
    fn drop(&mut self) {
        self.0.ended.fetch_add(1, Ordering::SeqCst);
    }
}

/// Takes the engine out of its last handle and stops idle work for good. A
/// failed unwrap is retried while an idle hold explains it, until `deadline`;
/// any other handle fails it at once.
pub(super) fn unwrap_after_idle<T>(
    mut access: Arc<EngineAccess<T>>,
    deadline: Instant,
) -> Result<EngineAccess<T>, Arc<EngineAccess<T>>> {
    access.close_quiet();
    let holds = Arc::clone(&access.quiet.holds);
    loop {
        let ended = holds.ended.load(Ordering::SeqCst);
        access = match Arc::try_unwrap(access) {
            Ok(access) => return Ok(access),
            Err(shared) => shared,
        };
        let open = holds.open();
        let ended_now = holds.ended.load(Ordering::SeqCst);
        if !idle_explains_failed_unwrap(ended, open, ended_now) || Instant::now() >= deadline {
            return Err(access);
        }
        if open > 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

/// A hold drops its reference before it counts as ended. So a failed unwrap
/// is idle work's doing when a hold is open now, or one ended after the
/// count read before the unwrap; otherwise another handle caused it.
fn idle_explains_failed_unwrap(ended_before: u64, open: u64, ended_now: u64) -> bool {
    open > 0 || ended_now != ended_before
}

#[cfg(test)]
mod test {
    use super::*;
    use std::future::{Future, poll_fn};
    use std::task::Poll;

    #[test]
    fn foreground_overtakes_warming_and_supersedes_its_snapshot() {
        pollster::block_on(async {
            let access = EngineAccess::new("initial");
            let blocker = access.lock().await;
            let mut hydration = std::pin::pin!(access.hydrate());
            let mut second_hydration = std::pin::pin!(access.hydrate());
            let mut third_hydration = std::pin::pin!(access.hydrate());
            let mut write = std::pin::pin!(access.write());
            poll_fn(|cx| {
                assert!(hydration.as_mut().poll(cx).is_pending());
                assert!(second_hydration.as_mut().poll(cx).is_pending());
                assert!(third_hydration.as_mut().poll(cx).is_pending());
                assert!(write.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(blocker);
            *write.await = "live";
            assert!(hydration.await.is_err());
            assert!(second_hydration.await.is_err());
            assert!(third_hydration.await.is_err());
            assert_eq!(*access.lock().await, "live");
            // A newly fetched page can resume warming after the live write.
            assert_eq!(*access.hydrate().await.expect("fresh hydration"), "live");
        });
    }

    #[test]
    fn reads_overtake_warming_without_discarding_its_snapshot() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let blocker = access.lock().await;
            let mut hydration = std::pin::pin!(access.hydrate());
            let mut read = std::pin::pin!(access.lock());
            poll_fn(|cx| {
                assert!(hydration.as_mut().poll(cx).is_pending());
                assert!(read.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(blocker);
            // Poll warming first: the foreground mutex reservation still wins.
            poll_fn(|cx| {
                assert!(hydration.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(read.await);
            assert_eq!(*hydration.await.expect("still current"), 0);
        });
    }

    #[test]
    fn releases_arm_one_idle_task_that_its_own_guard_never_rearms() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let starts = Arc::new(AtomicU64::new(0));
            let counted = Arc::clone(&starts);
            access.on_quiet(move |_, _| {
                counted.fetch_add(1, Ordering::SeqCst);
            });
            drop(access.lock().await);
            drop(access.write().await);
            drop(access.hydrate().await.expect("current"));
            assert_eq!(starts.load(Ordering::SeqCst), 1, "one task while armed");
            assert_eq!(access.quiet_releases(), 3);

            let held = access.lock().await;
            assert!(access.try_idle().is_none(), "a command holds the engine");
            drop(held);
            assert_eq!(starts.load(Ordering::SeqCst), 2, "its release re-arms");

            let idle = access.try_idle().expect("quiet engine");
            drop(idle);
            assert_eq!(
                starts.load(Ordering::SeqCst),
                2,
                "idle work never restarts itself"
            );
            assert_eq!(access.quiet_releases(), 4);

            access.close_quiet();
            drop(access.lock().await);
            assert!(access.try_idle().is_none(), "closed");
            assert_eq!(
                starts.load(Ordering::SeqCst),
                2,
                "nothing starts after close"
            );
        });
    }

    #[test]
    fn idle_work_never_overtakes_a_queued_command() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let blocker = access.lock().await;
            let mut queued = std::pin::pin!(access.lock());
            poll_fn(|cx| {
                assert!(queued.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(blocker);
            assert!(
                access.try_idle().is_none(),
                "the queued command owns the next turn"
            );
            drop(queued.await);
            assert!(access.try_idle().is_some());
        });
    }

    /// A hydrate waits on the release notice, not in the mutex queue, so a
    /// free mutex alone does not mean nothing waits.
    #[test]
    fn idle_work_never_overtakes_a_waiting_hydrate() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let blocker = access.lock().await;
            let mut hydration = std::pin::pin!(access.hydrate());
            poll_fn(|cx| {
                assert!(hydration.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(blocker);
            assert!(
                access.try_idle().is_none(),
                "the waiting hydrate owns the next turn"
            );
            drop(hydration.await.expect("current"));
            assert!(access.try_idle().is_some());
        });
    }

    /// Idle work that finds a hydrate waiting once it holds the engine gives
    /// it back with a wake, so the hydrate cannot sleep through it.
    #[test]
    fn idle_work_that_finds_a_waiting_hydrate_wakes_it() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let blocker = access.lock().await;
            let mut hydration = std::pin::pin!(access.hydrate());
            poll_fn(|cx| {
                assert!(hydration.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            drop(blocker);
            let woken = access.available.notified();
            let mut woken = std::pin::pin!(woken);
            woken.as_mut().enable();
            assert!(access.try_idle().is_none(), "a hydrate is waiting");
            poll_fn(|cx| {
                assert!(
                    woken.as_mut().poll(cx).is_ready(),
                    "the refusal woke waiters"
                );
                Poll::Ready(())
            })
            .await;
            drop(hydration.await.expect("current"));
        });
    }

    #[test]
    fn shutdown_waits_out_idle_holds_but_not_other_handles() {
        let deadline = || Instant::now() + Duration::from_secs(5);
        let access = Arc::new(EngineAccess::new(0));
        let other = Arc::clone(&access);
        let started = Instant::now();
        let Err(access) = unwrap_after_idle(access, deadline()) else {
            panic!("a command handle keeps the engine");
        };
        assert!(started.elapsed() < Duration::from_secs(1), "fails at once");
        drop(other);

        let holds = Arc::clone(&access.quiet.holds);
        let weak = Arc::downgrade(&access);
        let held = holds.hold(&weak).expect("alive");
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            drop(held);
        });
        assert!(unwrap_after_idle(access, deadline()).is_ok());
        releaser.join().unwrap();
        assert!(
            holds.hold(&weak).is_none(),
            "nothing to hold once unwrapped"
        );
    }

    /// An idle hold that ends between the failed unwrap and the check is
    /// still seen as the cause, so shutdown never blames a command handle.
    #[test]
    fn shutdown_never_mistakes_an_ending_idle_hold_for_a_handle() {
        assert!(!idle_explains_failed_unwrap(3, 0, 3), "no hold: a handle");
        assert!(idle_explains_failed_unwrap(3, 1, 3), "a hold is open");
        assert!(
            idle_explains_failed_unwrap(3, 0, 4),
            "a hold ended after the unwrap failed"
        );
        for _ in 0..2_000 {
            let access = Arc::new(EngineAccess::new(0));
            let holds = Arc::clone(&access.quiet.holds);
            let weak = Arc::downgrade(&access);
            let go = Arc::new(std::sync::Barrier::new(2));
            let idle = {
                let go = Arc::clone(&go);
                std::thread::spawn(move || {
                    let held = holds.hold(&weak);
                    go.wait();
                    drop(held);
                })
            };
            go.wait();
            let deadline = Instant::now() + Duration::from_secs(5);
            assert!(unwrap_after_idle(access, deadline).is_ok());
            idle.join().unwrap();
        }
    }

    fn pending<F: Future>(future: std::pin::Pin<&mut F>) -> bool {
        let waker = std::task::Waker::noop();
        future
            .poll(&mut std::task::Context::from_waker(waker))
            .is_pending()
    }

    /// Between a hydrate's halves only reads run: a command queued meanwhile
    /// waits for the hydrate to write, as it would have, and so do warming
    /// and idle work.
    #[test]
    fn a_held_turn_lets_reads_run_and_nothing_else() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let staging = access.hydrate().await.expect("current");
            let mut read = std::pin::pin!(access.read());
            assert!(pending(read.as_mut()), "the engine is held");
            let turn = staging
                .yield_to_reads(&access)
                .unwrap_or_else(|_| panic!("a hydrate holds a turn"));
            let mut command = std::pin::pin!(access.lock());
            let mut warming = std::pin::pin!(access.hydrate());
            let mut read = read.await;
            assert!(pending(command.as_mut()), "commands wait for the turn");
            assert!(pending(warming.as_mut()), "warming waits too");
            assert!(access.try_idle().is_none(), "and idle work");
            *read += 1;
            drop(read);
            let mut resumed = turn.resume().await;
            assert_eq!(*resumed, 1, "the read ran before the write");
            assert!(pending(command.as_mut()));
            *resumed += 10;
            drop(resumed);
            assert_eq!(*command.await, 11, "the command follows the hydrate");
            assert!(warming.await.is_ok());
        });
    }

    /// A read never overtakes a command that came before it, even when that
    /// command is waiting behind a hydrate's held turn.
    #[test]
    fn a_read_follows_a_command_still_waiting_for_its_turn() {
        pollster::block_on(async {
            let access = EngineAccess::new(Vec::new());
            let staging = access.hydrate().await.expect("current");
            let turn = staging
                .yield_to_reads(&access)
                .unwrap_or_else(|_| panic!("a hydrate holds a turn"));
            let mut command = std::pin::pin!(access.lock());
            assert!(pending(command.as_mut()));
            let mut read = std::pin::pin!(access.read());
            assert!(pending(read.as_mut()), "the read follows the command");
            turn.resume().await.push("hydrate");
            command.as_mut().await.push("command");
            read.await.push("read");
            assert_eq!(*access.lock().await, ["hydrate", "command", "read"]);
        });
    }

    struct Woken(AtomicBool);
    impl std::task::Wake for Woken {
        fn wake(self: Arc<Self>) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    /// A command cancelled after taking its turn, while it waits for the engine,
    /// still wakes a warming hydrate that waits for the turn.
    #[test]
    fn a_cancelled_command_wakes_hydrates_waiting_for_its_turn() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let read = access.read().await;
            let mut command = Box::pin(access.lock());
            assert!(
                pending(command.as_mut()),
                "it holds the turn and waits for the engine"
            );
            let woken = Arc::new(Woken(AtomicBool::new(false)));
            let waker = std::task::Waker::from(woken.clone());
            let mut warming = std::pin::pin!(access.hydrate());
            assert!(
                warming
                    .as_mut()
                    .poll(&mut std::task::Context::from_waker(&waker))
                    .is_pending()
            );
            drop(read);
            woken.0.store(false, Ordering::SeqCst);
            assert!(
                warming
                    .as_mut()
                    .poll(&mut std::task::Context::from_waker(&waker))
                    .is_pending(),
                "the command still holds the turn"
            );
            drop(command);
            assert!(
                woken.0.load(Ordering::SeqCst),
                "releasing the turn wakes it"
            );
            assert!(warming.await.is_ok());
        });
    }

    /// Idle work that takes the turn but finds the engine held gives the turn
    /// back with a wake: a hydrate may have found it held and gone to sleep
    /// after the release that freed the engine.
    #[test]
    fn idle_work_that_gives_the_turn_back_wakes_waiters() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let read = access.read().await;
            let notified = access.available.notified();
            let mut notified = std::pin::pin!(notified);
            notified.as_mut().enable();
            assert!(access.try_idle().is_none());
            assert!(
                !pending(notified.as_mut()),
                "giving the turn back woke waiters"
            );
            drop(read);
        });
    }

    /// Tokio hands a released turn straight to the next queued command. One
    /// cancelled before it runs gives the turn back with a wake, so a
    /// hydrate that found it handed out still runs.
    #[test]
    fn a_command_cancelled_once_handed_the_turn_wakes_waiting_hydrates() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let blocker = access.lock().await;
            let mut queued = Box::pin(access.lock());
            assert!(pending(queued.as_mut()));
            let mut hydration = std::pin::pin!(access.hydrate());
            assert!(pending(hydration.as_mut()));
            drop(blocker);
            assert!(
                pending(hydration.as_mut()),
                "the turn went to the queued command"
            );
            drop(queued);
            assert!(
                !pending(hydration.as_mut()),
                "the cancelled command woke the hydrate"
            );
        });
    }

    /// The same for a read handed the engine and cancelled before it runs.
    #[test]
    fn a_read_cancelled_once_handed_the_engine_wakes_waiting_hydrates() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let command = access.lock().await;
            let mut read = Box::pin(access.read());
            assert!(pending(read.as_mut()));
            let mut hydration = std::pin::pin!(access.hydrate());
            assert!(pending(hydration.as_mut()));
            drop(command);
            assert!(pending(hydration.as_mut()), "the engine went to the read");
            drop(read);
            assert!(
                !pending(hydration.as_mut()),
                "the cancelled read woke the hydrate"
            );
        });
    }

    /// A warming hydrate never keeps the turn while a read holds the engine,
    /// so a command that queues meanwhile still goes first, as it did when
    /// hydrates waited only for the engine.
    #[test]
    fn a_command_queued_behind_a_read_goes_before_a_waiting_hydrate() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let read = access.read().await;
            let mut hydration = std::pin::pin!(access.hydrate());
            assert!(pending(hydration.as_mut()));
            let mut command = std::pin::pin!(access.lock());
            assert!(pending(command.as_mut()));
            drop(read);
            assert!(pending(hydration.as_mut()), "the command goes first");
            assert!(!pending(command.as_mut()));
            assert!(!pending(hydration.as_mut()));
        });
    }

    #[test]
    fn a_read_guard_holds_no_turn_to_keep() {
        pollster::block_on(async {
            let access = EngineAccess::new(0);
            let read = access.read().await;
            assert!(read.yield_to_reads(&access).is_err());
        });
    }
}
