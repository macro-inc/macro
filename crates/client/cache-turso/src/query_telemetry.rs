//! Optional, thread-local instrumentation for the synchronous SQL driver.
//!
//! The browser composition root supplies a monotonic clock and an exception-safe
//! sink. Neither SQL text, bound values, nor rows cross this boundary.

use crate::driver::WalCheckpoint;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

/// Queries must strictly exceed this execution time to be reported.
pub const SLOW_QUERY_THRESHOLD_MS: f64 = 200.0;

/// Writes to storage and flushes of it, as totals since the thread started
/// or as the difference across one statement or checkpoint.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct StorageIo {
    /// Write requests.
    pub writes: u64,
    /// Bytes they wrote.
    pub write_bytes: u64,
    /// Milliseconds spent writing.
    pub write_ms: f64,
    /// Flushes to disk.
    pub flushes: u64,
    /// Milliseconds spent flushing.
    pub flush_ms: f64,
}

impl StorageIo {
    /// What happened between `earlier` and these totals.
    pub fn since(self, earlier: Self) -> Self {
        Self {
            writes: self.writes.saturating_sub(earlier.writes),
            write_bytes: self.write_bytes.saturating_sub(earlier.write_bytes),
            write_ms: (self.write_ms - earlier.write_ms).max(0.0),
            flushes: self.flushes.saturating_sub(earlier.flushes),
            flush_ms: (self.flush_ms - earlier.flush_ms).max(0.0),
        }
    }
}

/// A WAL copy run right after the COMMIT that took the WAL to its cap,
/// while the request that committed still waits for its answer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CappedCheckpoint {
    /// Milliseconds the copy took.
    pub duration_ms: f64,
    /// Whether it completed; a failed copy leaves the WAL whole.
    pub success: bool,
    /// Frames in the WAL when it started.
    pub wal_frames: u64,
    /// Frames it copied into the database file.
    pub backfilled_frames: u64,
    /// What it wrote and flushed.
    pub io: StorageIo,
}

/// COMMITs that wrote, on this thread, since it started.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CommitTotals {
    /// How many.
    pub commits: u64,
    /// Milliseconds they took, the WAL append and flush included.
    pub commit_ms: f64,
}

/// Host-provided instrumentation for the current cache engine thread.
pub trait QueryTelemetry {
    /// Monotonic milliseconds. Return NaN when the clock is unavailable.
    fn now_ms(&self) -> f64;
    /// The host's storage totals so far, or zero where it does not count them.
    fn storage_io(&self) -> StorageIo {
        StorageIo::default()
    }
    /// Report a slow execution and the storage writes and flushes made
    /// during it. Implementations must not panic or throw.
    fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool, io: StorageIo);
    /// Report a capped WAL copy. Implementations must not panic or throw.
    fn capped_checkpoint(&self, _checkpoint: CappedCheckpoint) {}
}

thread_local! {
    static TELEMETRY: RefCell<Option<Rc<dyn QueryTelemetry>>> = const { RefCell::new(None) };
    static COMMITS: Cell<CommitTotals> = const {
        Cell::new(CommitTotals {
            commits: 0,
            commit_ms: 0.0,
        })
    };
}

/// The COMMITs that wrote so far on this thread, while instrumentation was
/// installed.
pub fn commit_totals() -> CommitTotals {
    COMMITS.with(Cell::get)
}

/// Install (or disable) instrumentation on the current cache engine thread.
/// Native hosts remain uninstrumented unless they explicitly install a sink.
pub fn set_query_telemetry(telemetry: Option<Rc<dyn QueryTelemetry>>) {
    TELEMETRY.with(|slot| *slot.borrow_mut() = telemetry);
}

pub(crate) struct QueryTimer {
    telemetry: Rc<dyn QueryTelemetry>,
    started_at: f64,
    io: StorageIo,
}

impl QueryTimer {
    pub(crate) fn start() -> Option<Self> {
        let telemetry = TELEMETRY.with(|slot| slot.borrow().clone())?;
        let io = telemetry.storage_io();
        let started_at = telemetry.now_ms();
        Some(Self {
            telemetry,
            started_at,
            io,
        })
    }

    fn elapsed_ms(&self) -> f64 {
        self.telemetry.now_ms() - self.started_at
    }

    fn io(&self) -> StorageIo {
        self.telemetry.storage_io().since(self.io)
    }

    pub(crate) fn finish(self, sql: &str, success: bool) {
        let duration_ms = self.elapsed_ms();
        if duration_ms.is_finite() && duration_ms > SLOW_QUERY_THRESHOLD_MS {
            self.telemetry
                .slow_query(&fingerprint(sql), duration_ms, success, self.io());
        }
    }

    /// Counts a COMMIT that wrote, timed from `start`.
    pub(crate) fn finish_commit(self) {
        let duration_ms = self.elapsed_ms();
        COMMITS.with(|totals| {
            let mut next = totals.get();
            next.commits += 1;
            if duration_ms.is_finite() && duration_ms >= 0.0 {
                next.commit_ms += duration_ms;
            }
            totals.set(next);
        });
    }

    /// Reports the capped copy timed from `start`, when it ran or failed.
    pub(crate) fn finish_capped_checkpoint<E>(self, copy: &Result<WalCheckpoint, E>) {
        let (success, wal_frames, backfilled_frames) = match copy {
            Ok(checkpoint) if !checkpoint.ran => return,
            Ok(checkpoint) => (true, checkpoint.wal_frames, checkpoint.backfilled_frames),
            Err(_) => (false, 0, 0),
        };
        let duration_ms = self.elapsed_ms();
        if !duration_ms.is_finite() {
            return;
        }
        self.telemetry.capped_checkpoint(CappedCheckpoint {
            duration_ms,
            success,
            wal_frames,
            backfilled_frames,
            io: self.io(),
        });
    }
}

// Stable FNV-1a of the unexpanded statement template, never of bound values.
// Hash only slow queries, keeping the hot path to two clock reads.
pub(crate) fn fingerprint(sql: &str) -> String {
    let hash = sql.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}

#[cfg(test)]
mod test;
