//! Mutex with tracking and warnings when we lock for too long.
//! Taken from [quinn](https://github.com/quinn-rs/quinn/blob/491b8b5deb14ff5c1e4ba709b7936855e63aeef5/quinn/src/mutex.rs).
use std::{
    collections::VecDeque,
    fmt::Debug,
    ops::{Deref, DerefMut},
    time::Duration,
};
use tracing::warn;
use web_time::Instant;

#[derive(Debug)]
struct Inner<T> {
    last_lock_owner: VecDeque<(&'static str, Duration)>,
    value: T,
}

/// A Mutex which optionally allows to track the time a lock was held and
/// emit warnings in case of excessive lock times
pub(crate) struct Mutex<T> {
    inner: std::sync::Mutex<Inner<T>>,
}

impl<T: Debug> std::fmt::Debug for Mutex<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&self.inner, f)
    }
}

impl<T> Mutex<T> {
    pub(crate) const fn new(value: T) -> Self {
        Self {
            inner: std::sync::Mutex::new(Inner {
                last_lock_owner: VecDeque::new(),
                value,
            }),
        }
    }

    /// Acquires the lock for a certain purpose
    ///
    /// The purpose will be recorded in the list of last lock owners
    pub(crate) fn lock(&self, purpose: &'static str) -> MutexGuard<'_, T> {
        // We don't bother dispatching through Runtime::now because they're pure performance
        // diagnostics.
        let now = Instant::now();
        let guard = self.inner.lock().unwrap();

        let lock_time = Instant::now();
        let elapsed = lock_time.duration_since(now);

        if elapsed > Duration::from_millis(1) {
            warn!(
                "Locking the connection for {} took {:?}. Last owners: {:?}",
                purpose, elapsed, guard.last_lock_owner
            );
        }

        MutexGuard {
            guard,
            start_time: lock_time,
            purpose,
        }
    }
}

pub(crate) struct MutexGuard<'a, T> {
    guard: std::sync::MutexGuard<'a, Inner<T>>,
    start_time: Instant,
    purpose: &'static str,
}

impl<T> Drop for MutexGuard<'_, T> {
    fn drop(&mut self) {
        if self.guard.last_lock_owner.len() == MAX_LOCK_OWNERS {
            self.guard.last_lock_owner.pop_back();
        }

        let duration = self.start_time.elapsed();

        if duration > Duration::from_millis(1) {
            warn!(
                "Utilizing the connection for {} took {:?}",
                self.purpose, duration
            );
        }

        self.guard
            .last_lock_owner
            .push_front((self.purpose, duration));
    }
}

impl<T> Deref for MutexGuard<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.guard.value
    }
}

impl<T> DerefMut for MutexGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.guard.value
    }
}

impl<'a, T> MutexGuard<'a, T> {
    #[cfg(test)]
    fn last_owners(&self) -> &VecDeque<(&'static str, Duration)> {
        &self.guard.last_lock_owner
    }
}

const MAX_LOCK_OWNERS: usize = 20;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mutex_creation() {
        let mutex = Mutex::new(42);
        let guard = mutex.lock("test");
        assert_eq!(*guard, 42);
    }

    #[test]
    fn test_mutex_mutation() {
        let mutex = Mutex::new(0);
        {
            let mut guard = mutex.lock("increment");
            *guard += 1;
        }
        let guard = mutex.lock("read");
        assert_eq!(*guard, 1);
    }

    #[test]
    fn test_lock_tracking_single() {
        let mutex: Mutex<String> = Mutex::new(String::new());

        {
            let _guard = mutex.lock("operation_1");
            // Guard is dropped here
        }

        // Check that lock was recorded
        let guard = mutex.lock("operation_2");
        let owners = guard.last_owners();
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].0, "operation_1");
    }

    #[test]
    fn test_lock_tracking_multiple() {
        let mutex: Mutex<i32> = Mutex::new(0);

        for i in 0..5 {
            let purpose = ["op1", "op2", "op3", "op4", "op5"][i];
            let _guard = mutex.lock(purpose);
            // Guard is dropped
        }

        let guard = mutex.lock("final");
        let owners = guard.last_owners();
        // Should have 5 entries in reverse order (most recent first)
        assert_eq!(owners.len(), 5);
        assert_eq!(owners[0].0, "op5");
        assert_eq!(owners[4].0, "op1");
    }

    #[test]
    fn test_max_lock_owners_limit() {
        let mutex: Mutex<()> = Mutex::new(());

        // Acquire lock MAX_LOCK_OWNERS + 5 times
        for i in 0..(MAX_LOCK_OWNERS + 5) {
            let purpose = Box::leak(format!("op_{}", i).into_boxed_str());
            let _guard = mutex.lock(purpose);
        }

        let guard = mutex.lock("final");
        let owners = guard.last_owners();
        // Should only have MAX_LOCK_OWNERS entries, not more
        assert_eq!(owners.len(), MAX_LOCK_OWNERS);
        // Most recent should be op_24 (which is MAX_LOCK_OWNERS + 4)
        assert_eq!(owners[0].0, "op_24");
    }

    #[test]
    fn test_lock_guard_deref() {
        let mutex = Mutex::new(vec![1, 2, 3]);
        let guard = mutex.lock("read");
        assert_eq!(guard.len(), 3);
        assert_eq!(guard[0], 1);
    }

    #[test]
    fn test_lock_guard_deref_mut() {
        let mutex = Mutex::new(vec![1, 2, 3]);
        {
            let mut guard = mutex.lock("modify");
            guard.push(4);
        }
        let guard = mutex.lock("verify");
        assert_eq!(guard.len(), 4);
        assert_eq!(guard[3], 4);
    }
}
