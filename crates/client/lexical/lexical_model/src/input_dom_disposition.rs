//! Host event facts scoped to one actual Core input, independently of model publication.
use crate::Error;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU8, Ordering},
};

const PREVENT: u8 = 1;
const STOP: u8 = 2;

/// Calls already made by native handlers, not graph or publication authority.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InputDomDisposition {
    /// The handler requested browser-default suppression.
    pub default_prevented: bool,
    /// The handler requested DOM propagation to stop.
    pub propagation_stopped: bool,
}
impl InputDomDisposition {
    /// Whether no host action was requested.
    pub fn is_empty(self) -> bool {
        !self.default_prevented && !self.propagation_stopped
    }
}

/// Poison permanently refuses later Core inputs on this Editor. Do not clear it:
/// continuing could lose the attribution of already-performed host actions.
#[derive(Clone, Default)]
pub(crate) struct InputDomScopes(Arc<Mutex<Vec<Arc<AtomicU8>>>>);
impl InputDomScopes {
    pub(crate) fn enter(&self) -> Result<InputDomScope, Error> {
        let recorder = Arc::new(AtomicU8::new(0));
        {
            let mut frames = self.0.lock().map_err(|poisoned| {
                drop(poisoned.into_inner());
                Error::Invariant("input DOM scope lock poisoned")
            })?;
            frames.push(recorder.clone());
        }
        Ok(InputDomScope {
            scopes: self.clone(),
            recorder,
        })
    }
    pub(crate) fn prevent_default(&self) {
        let frames = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(recorder) = frames.last() {
            recorder.fetch_or(PREVENT, Ordering::Relaxed);
        }
        // No callback, listener, dispatch or model operation runs under this lock.
    }
    pub(crate) fn stop_propagation(&self) -> Result<(), Error> {
        let frames = self.0.lock().map_err(|poisoned| {
            drop(poisoned.into_inner());
            Error::Invariant("input DOM scope lock poisoned")
        })?;
        let recorder = frames
            .last()
            .ok_or(Error::Invariant("DOM propagation requires an active input"))?;
        recorder.fetch_or(STOP, Ordering::Relaxed);
        Ok(())
    }
}

pub(crate) struct InputDomScope {
    scopes: InputDomScopes,
    recorder: Arc<AtomicU8>,
}
impl InputDomScope {
    pub(crate) fn snapshot(&self) -> InputDomDisposition {
        let bits = self.recorder.load(Ordering::Relaxed);
        InputDomDisposition {
            default_prevented: bits & PREVENT != 0,
            propagation_stopped: bits & STOP != 0,
        }
    }
}
impl Drop for InputDomScope {
    fn drop(&mut self) {
        let ordered = {
            let mut frames = self
                .scopes
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let found = frames
                .iter()
                .position(|recorder| Arc::ptr_eq(recorder, &self.recorder));
            let ordered = found.is_some_and(|index| index + 1 == frames.len());
            if let Some(index) = found {
                frames.remove(index);
            }
            ordered
        };
        // Restore the right frame before reporting an internal ordering bug.
        // Never panic a second time while already unwinding; no lock spans the assertion.
        if !std::thread::panicking() {
            debug_assert!(ordered, "input DOM scopes dropped out of order");
        }
    }
}

#[cfg(test)]
mod test;
