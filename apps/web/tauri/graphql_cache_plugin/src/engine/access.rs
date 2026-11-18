//! Foreground commands retain FIFO order; cache warming never reserves a turn
//! ahead of them. Superseded warming must be fetched again, not replayed after
//! the authoritative write that overtook it.
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{Mutex, MutexGuard, Notify};

pub(super) struct EngineAccess<T> {
    value: Mutex<T>,
    available: Notify,
    write_epoch: AtomicU64,
}

impl<T> EngineAccess<T> {
    pub(super) fn new(value: T) -> Self {
        Self {
            value: Mutex::new(value),
            available: Notify::new(),
            write_epoch: AtomicU64::new(0),
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
            _release: ReleaseNotice(&self.available),
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
                    _release: ReleaseNotice(&self.available),
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
struct ReleaseNotice<'a>(&'a Notify);
impl Drop for ReleaseNotice<'_> {
    fn drop(&mut self) {
        self.0.notify_waiters();
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
}
