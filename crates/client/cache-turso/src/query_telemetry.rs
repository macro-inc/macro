//! Optional, thread-local instrumentation for the synchronous SQL driver.
//!
//! The browser composition root supplies a monotonic clock and an exception-safe
//! sink. Neither SQL text, bound values, nor rows cross this boundary.

use std::{cell::RefCell, rc::Rc};

/// Queries must strictly exceed this execution time to be reported.
pub const SLOW_QUERY_THRESHOLD_MS: f64 = 200.0;

/// Host-provided instrumentation for the current cache engine thread.
pub trait QueryTelemetry {
    /// Monotonic milliseconds. Return NaN when the clock is unavailable.
    fn now_ms(&self) -> f64;
    /// Report a slow execution. Implementations must not panic or throw.
    fn slow_query(&self, fingerprint: &str, duration_ms: f64, success: bool);
}

thread_local! {
    static TELEMETRY: RefCell<Option<Rc<dyn QueryTelemetry>>> = const { RefCell::new(None) };
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
