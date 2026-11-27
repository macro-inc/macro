//! Thread-local instrumentation for the synchronous SQL driver.
//!
//! The browser composition root supplies a monotonic clock and an exception-safe
//! sink. Neither SQL text, bound values, nor rows cross this boundary. The
//! driver also counts statement executions and the rows they step, always: two
//! integer increments, read by hosts that measure how much SQL work an engine
//! call costs.

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

/// Queries must strictly exceed this execution time to be reported.
pub const SLOW_QUERY_THRESHOLD_MS: f64 = 200.0;

/// Host-provided instrumentation for the current cache engine thread.
pub trait QueryTelemetry {
    /// Monotonic milliseconds. Return NaN when the clock is unavailable.
    fn now_ms(&self) -> f64;
    /// Report a slow execution. Implementations must not panic or throw.
    fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool);
}

/// SQL work the driver did on this thread since it started.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SqlCounts {
    /// Statement executions, transaction control included. A reused prepared
    /// statement counts once per execution.
    pub statements: u64,
    /// Rows those executions stepped, whether or not the caller kept them.
    pub rows: u64,
}

thread_local! {
    static TELEMETRY: RefCell<Option<Rc<dyn QueryTelemetry>>> = const { RefCell::new(None) };
    static COUNTS: Cell<SqlCounts> = const { Cell::new(SqlCounts { statements: 0, rows: 0 }) };
}

/// The SQL work done on this thread so far. Hosts diff two readings.
pub fn sql_counts() -> SqlCounts {
    COUNTS.with(Cell::get)
}

pub(crate) fn count_statement() {
    COUNTS.with(|counts| {
        let mut next = counts.get();
        next.statements = next.statements.wrapping_add(1);
        counts.set(next);
    });
}

pub(crate) fn count_row() {
    COUNTS.with(|counts| {
        let mut next = counts.get();
        next.rows = next.rows.wrapping_add(1);
        counts.set(next);
    });
}

/// Install (or disable) instrumentation on the current cache engine thread.
/// Native hosts remain uninstrumented unless they explicitly install a sink.
pub fn set_query_telemetry(telemetry: Option<Rc<dyn QueryTelemetry>>) {
    TELEMETRY.with(|slot| *slot.borrow_mut() = telemetry);
}

pub(crate) struct QueryTimer {
    telemetry: Rc<dyn QueryTelemetry>,
    started_at: f64,
}

impl QueryTimer {
    pub(crate) fn start() -> Option<Self> {
        let telemetry = TELEMETRY.with(|slot| slot.borrow().clone())?;
        let started_at = telemetry.now_ms();
        Some(Self {
            telemetry,
            started_at,
        })
    }

    pub(crate) fn finish(self, sql: &str, success: bool) {
        let duration_ms = self.telemetry.now_ms() - self.started_at;
        if duration_ms.is_finite() && duration_ms > SLOW_QUERY_THRESHOLD_MS {
            self.telemetry
                .slow_query(&fingerprint(sql), duration_ms, success);
        }
    }
}

// Stable FNV-1a of the unexpanded statement template, never of bound values.
// Hash only slow queries, keeping the hot path to two clock reads.
fn fingerprint(sql: &str) -> String {
    let hash = sql.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}

#[cfg(test)]
mod test;
