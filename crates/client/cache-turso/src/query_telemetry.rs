//! Optional, thread-local instrumentation for the synchronous SQL driver.
//!
//! The browser composition root supplies a monotonic clock and an exception-safe
//! sink. A slow statement is reported by the fingerprint of its text and, the
//! first time this thread reports that fingerprint, by the text itself when it
//! is a [`Sql`](crate::sql::Sql) template: text built only from this crate's
//! own fragments, with values in placeholders. Bound values and rows never
//! cross this boundary, nor does the text of a statement that embeds anything
//! else.

use crate::sql::Reportable;
use std::{cell::RefCell, collections::HashSet, rc::Rc};

/// Queries must strictly exceed this execution time to be reported.
pub const SLOW_QUERY_THRESHOLD_MS: f64 = 200.0;

/// Longest template text sent, in bytes. Longer texts keep their first and
/// last halves around a comment giving the full length; the longest template
/// the browser has reported slow (a 500-ID predicate selection) is about
/// 7 KB.
pub const SLOW_QUERY_TEMPLATE_BYTES: usize = 8 * 1024;

/// Fingerprints whose text this thread has sent. Past this many the set
/// starts over, so a text may be sent again; templates are a fixed set of a
/// few hundred shapes, and texts sized to their keys share a shape's prefix.
const SENT_TEMPLATES: usize = 512;

/// Host-provided instrumentation for the current cache engine thread.
pub trait QueryTelemetry {
    /// Monotonic milliseconds. Return NaN when the clock is unavailable.
    fn now_ms(&self) -> f64;
    /// Report a slow execution. `template` is the statement's template text
    /// the first time this thread reports its fingerprint, at most
    /// [`SLOW_QUERY_TEMPLATE_BYTES`] long, and `None` after that or when the
    /// statement is not a template. Implementations must not panic or throw.
    fn slow_query(
        &self,
        fingerprint: &str,
        duration_ms: f64,
        success: bool,
        template: Option<&str>,
    );
}

thread_local! {
    static TELEMETRY: RefCell<Option<Rc<dyn QueryTelemetry>>> = const { RefCell::new(None) };
    static SENT: RefCell<HashSet<u64>> = RefCell::new(HashSet::new());
}

/// Install (or disable) instrumentation on the current cache engine thread.
/// Native hosts remain uninstrumented unless they explicitly install a sink.
pub fn set_query_telemetry(telemetry: Option<Rc<dyn QueryTelemetry>>) {
    TELEMETRY.with(|slot| *slot.borrow_mut() = telemetry);
    SENT.with(|sent| sent.borrow_mut().clear());
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

    /// `reportable` says whether `sql` is a template whose text may be sent.
    pub(crate) fn finish(self, sql: &str, reportable: Reportable, success: bool) {
        let duration_ms = self.telemetry.now_ms() - self.started_at;
        if !(duration_ms.is_finite() && duration_ms > SLOW_QUERY_THRESHOLD_MS) {
            return;
        }
        let hash = fnv1a(sql);
        let template = (reportable.text_may_be_sent() && first_report(hash)).then(|| bounded(sql));
        self.telemetry.slow_query(
            &format!("{hash:016x}"),
            duration_ms,
            success,
            template.as_deref(),
        );
    }
}

/// Whether this thread has not sent the text of `hash` yet; records it.
fn first_report(hash: u64) -> bool {
    SENT.with(|sent| {
        let mut sent = sent.borrow_mut();
        if sent.contains(&hash) {
            return false;
        }
        if sent.len() >= SENT_TEMPLATES {
            sent.clear();
        }
        sent.insert(hash)
    })
}

/// `sql`, or its first and last halves around a comment giving its length.
fn bounded(sql: &str) -> String {
    if sql.len() <= SLOW_QUERY_TEMPLATE_BYTES {
        return sql.to_owned();
    }
    let marker = format!(" /* {} bytes */ ", sql.len());
    let half = (SLOW_QUERY_TEMPLATE_BYTES - marker.len()) / 2;
    let head = sql.floor_char_boundary(half);
    let tail = sql.ceil_char_boundary(sql.len() - half);
    format!("{}{marker}{}", &sql[..head], &sql[tail..])
}

// Stable FNV-1a of the unexpanded statement template, never of bound values.
// Hash only slow queries, keeping the hot path to two clock reads.
fn fnv1a(sql: &str) -> u64 {
    sql.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

#[cfg(test)]
fn fingerprint(sql: &str) -> String {
    format!("{:016x}", fnv1a(sql))
}

#[cfg(test)]
mod test;
