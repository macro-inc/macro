//! Foreground commands retain FIFO order; cache warming never reserves a turn
//! ahead of them. Superseded warming must be fetched again, not replayed after
//! the authoritative write that overtook it.
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, MutexGuard, Notify};

pub(super) struct EngineAccess<T> {
    value: Mutex<T>,
    available: Notify,
    write_epoch: AtomicU64,
    quiet: Quiet,
}

impl<T> EngineAccess<T> {
    pub(super) fn new(value: T) -> Self {
        Self {
            value: Mutex::new(value),
            available: Notify::new(),
            write_epoch: AtomicU64::new(0),
            quiet: Quiet::default(),
        }
    }

    /// Calls `start` after a release when no idle task is armed. The task it
    /// starts waits for [`Self::quiet_releases`] to stop changing, then takes
    /// the engine with [`Self::try_idle`]; `busy` is set while it holds it.
    pub(super) fn on_quiet(&self, start: impl Fn(Arc<AtomicBool>) + Send + Sync + 'static) {
        let _ = self.quiet.start.set(Box::new(start));
    }

    /// Counts guard releases, so an idle task can tell the engine was used.
    pub(super) fn quiet_releases(&self) -> u64 {
        self.quiet.releases.load(Ordering::SeqCst)
    }

    /// Takes the engine for idle work without waiting, or `None` when it is
    /// held, a command is queued for it, or shutdown began. Either way the
    /// idle task is done: the next release starts another. Its own release
    /// wakes waiters but starts nothing.
    pub(super) fn try_idle(&self) -> Option<AccessGuard<'_, T>> {
        self.quiet.armed.store(false, Ordering::SeqCst);
        if self.quiet.closed.load(Ordering::SeqCst) {
            return None;
        }
        let value = self.value.try_lock().ok()?;
        Some(AccessGuard {
            value,
            _release: ReleaseNotice {
                available: &self.available,
                quiet: None,
            },
        })
    }

    /// Stops idle work for good, before the engine is closed.
    pub(super) fn close_quiet(&self) {
        self.quiet.closed.store(true, Ordering::SeqCst);
    }

    /// Whether an idle task may hold a strong reference right now.
    pub(super) fn idle_running(&self) -> bool {
        self.quiet.busy.load(Ordering::SeqCst)
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
        AccessGuard {
            value: self.value.lock().await,
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
        let _wait = AcquisitionWait::new();
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
            if let Ok(value) = self.value.try_lock() {
                let guard = AccessGuard {
                    value,
                    _release: self.release_notice(),
                };
                if epoch != self.write_epoch.load(Ordering::SeqCst) {
                    return Err(
                        "cache hydration superseded by a foreground write; refetch the page".into(),
                    );
                }
                return Ok(guard);
            }
            notified.await;
        }
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

pub(super) struct AccessGuard<'a, T> {
    value: MutexGuard<'a, T>,
    _release: ReleaseNotice<'a>,
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

/// Idle work for the host to run once commands stop: at most one task armed
/// at a time, started by the first release after the last one finished.
#[derive(Default)]
struct Quiet {
    releases: AtomicU64,
    armed: AtomicBool,
    closed: AtomicBool,
    busy: Arc<AtomicBool>,
    start: OnceLock<Box<dyn Fn(Arc<AtomicBool>) + Send + Sync>>,
}
impl Quiet {
    fn released(&self) {
        self.releases.fetch_add(1, Ordering::SeqCst);
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        if let Some(start) = self.start.get()
            && !self.armed.swap(true, Ordering::SeqCst)
        {
            start(Arc::clone(&self.busy));
        }
    }
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
            access.on_quiet(move |_| {
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
}
