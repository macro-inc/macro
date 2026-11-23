//! Reads whose caller stopped waiting. Tauri cannot cancel a command, so a
//! read the webview timed out on still waits for the engine and runs. After a
//! stall those reads hold the engine ahead of the ones a caller still waits
//! for, which then time out too. A read sent with a request id registers it
//! here; the webview sends that id to `graphql_cache_abandon` when it stops
//! waiting, and the read, once it gets the engine, gives it back without
//! reading (`EngineHandle::ready_op_read`). It keeps its place in the queue,
//! so the commands queued behind it still find the engine as they would
//! have. A read that already holds the engine finishes.
//!
//! A read of an operation also registers which records that operation
//! depends on, so later writes report it affected. An abandoned one registers
//! the operation against every change instead, in its place: the next write
//! reports it, and its re-read registers its records again.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Request ids are opaque webview strings; longer ones are not registered.
const MAX_REQUEST_ID_LEN: usize = 128;

pub(super) const ABANDONED: &str = "graphql cache read abandoned by its caller";

/// The reads now running with a request id, shared by every handle of one
/// engine.
#[derive(Default)]
pub(super) struct Abandons {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Abandons {
    /// Registers a read until the returned registration drops. An id already
    /// running is not registered again, so an abandon never reaches a read
    /// other than the first that used its id.
    pub(super) fn register(self: &Arc<Self>, id: String) -> Option<Registration> {
        if id.len() > MAX_REQUEST_ID_LEN {
            return None;
        }
        let abandoned = Arc::new(AtomicBool::new(false));
        let mut running = self.running.lock().ok()?;
        if running.contains_key(&id) {
            return None;
        }
        running.insert(id.clone(), Arc::clone(&abandoned));
        drop(running);
        Some(Registration {
            abandons: Arc::clone(self),
            id,
            abandoned,
        })
    }

    #[cfg(test)]
    pub(super) fn running(&self) -> usize {
        self.running.lock().map_or(0, |reads| reads.len())
    }

    /// Marks the read with this id abandoned, and says whether one was
    /// running. An id that finished, or never came, is ignored.
    pub(super) fn abandon(&self, id: &str) -> bool {
        let abandoned = self
            .running
            .lock()
            .ok()
            .and_then(|reads| reads.get(id).cloned());
        abandoned.is_some_and(|abandoned| {
            abandoned.store(true, Ordering::SeqCst);
            true
        })
    }
}

/// One read's entry in [`Abandons`], removed when the read's command ends.
pub(super) struct Registration {
    abandons: Arc<Abandons>,
    id: String,
    abandoned: Arc<AtomicBool>,
}

impl Registration {
    pub(super) fn is_abandoned(&self) -> bool {
        self.abandoned.load(Ordering::SeqCst)
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut reads) = self.abandons.running.lock()
            && reads
                .get(&self.id)
                .is_some_and(|abandoned| Arc::ptr_eq(abandoned, &self.abandoned))
        {
            reads.remove(&self.id);
        }
    }
}
