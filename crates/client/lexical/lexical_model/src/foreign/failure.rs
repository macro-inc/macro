//! Fallible host-operation boundaries for infallible runtime read predicates.
use crate::Error;
use std::{cell::RefCell, marker::PhantomData, sync::Arc};

struct Frame {
    token: Arc<()>,
    error: Option<Arc<Error>>,
}
thread_local! {
    // Failure transport only. Editor/update/lease capabilities authorize reads.
    static FRAMES: RefCell<Vec<Frame>> = const { RefCell::new(Vec::new()) };
}

/// A synchronous development host operation that can report read-hook failures.
///
/// This carries no model borrow or editor authority. Native predicates keep their
/// infallible signatures; a host must bracket JS-backed reads with this boundary,
/// defer a caught exception, and check before any observable side effect. The
/// guard cannot move between threads. Nested operations isolate caught failures.
pub struct ForeignReadOperation {
    token: Arc<()>,
    // A marker only; no raw pointer or model reference is stored.
    thread: PhantomData<*mut ()>,
}
impl ForeignReadOperation {
    /// Open a nested fallible operation, rejecting an already failed parent.
    pub fn begin() -> Result<Self, Error> {
        Self::check()?;
        let token = Arc::new(());
        FRAMES.with(|frames| {
            frames
                .try_borrow_mut()
                .map_err(|_| Error::Invariant("foreign failure store is borrowed"))?
                .push(Frame {
                    token: token.clone(),
                    error: None,
                });
            Ok::<_, Error>(())
        })?;
        Ok(Self {
            token,
            thread: PhantomData,
        })
    }

    /// Whether this thread is executing a fallible host operation.
    pub fn is_active() -> bool {
        FRAMES.with(|frames| frames.try_borrow().is_ok_and(|frames| !frames.is_empty()))
    }

    /// Save the first read-hook failure of the current operation.
    /// Reject unscoped use without retaining an error on this thread.
    pub fn defer(error: Error) -> Result<(), Error> {
        FRAMES.with(|frames| {
            let mut frames = frames
                .try_borrow_mut()
                .map_err(|_| Error::Invariant("foreign failure store is borrowed"))?;
            let frame = frames.last_mut().ok_or(Error::Invariant(
                "foreign read hook requires a fallible operation",
            ))?;
            if frame.error.is_none() {
                frame.error = Some(match error {
                    Error::ForeignReadFailed(error) => error,
                    error => Arc::new(error),
                });
            }
            Ok(())
        })
    }

    /// Stop callbacks, writes and memo publication after a deferred failure.
    /// Ordinary native model operations need no scope and remain unaffected.
    pub fn check() -> Result<(), Error> {
        let error = FRAMES.with(|frames| {
            Ok::<_, Error>(
                frames
                    .try_borrow()
                    .map_err(|_| Error::Invariant("foreign failure store is borrowed"))?
                    .last()
                    .and_then(|frame| frame.error.clone()),
            )
        })?;
        match error {
            Some(error) => Err(Error::ForeignReadFailed(error)),
            None => Ok(()),
        }
    }

    /// Return the operation result, preferring its first deferred read failure.
    /// The scope closes on both success and failure.
    pub fn finish<Value, Failure: From<Error>>(
        self,
        result: Result<Value, Failure>,
    ) -> Result<Value, Failure> {
        let check = FRAMES.with(|frames| {
            let frames = frames
                .try_borrow()
                .map_err(|_| Error::Invariant("foreign failure store is borrowed"))?;
            let frame = frames
                .last()
                .filter(|frame| Arc::ptr_eq(&frame.token, &self.token))
                .ok_or(Error::Invariant(
                    "foreign operation scopes closed out of order",
                ))?;
            match &frame.error {
                Some(error) => Err(Error::ForeignReadFailed(error.clone())),
                None => Ok(()),
            }
        });
        check?;
        result
    }
}
impl Drop for ForeignReadOperation {
    fn drop(&mut self) {
        let removed = FRAMES.with(|frames| {
            let Ok(mut frames) = frames.try_borrow_mut() else {
                return None;
            };
            let index = frames
                .iter()
                .position(|frame| Arc::ptr_eq(&frame.token, &self.token))?;
            Some(frames.remove(index))
        });
        drop(removed);
    }
}

#[cfg(test)]
mod test;
