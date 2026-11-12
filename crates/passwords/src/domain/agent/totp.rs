//! Conservative verification-code lifetime from a bracket around the provider call.
//!
//! The provider returns only the code. Under the operational assumption that
//! the provider and vault clocks differ by at most `MARGIN`, the provider chose
//! the code's counter somewhere in `[t0 - MARGIN, t1 + MARGIN]`. When that whole
//! closed interval lies in one period window the counter is known, and the code
//! stays valid on the provider until the window end; `end - MARGIN` is a safe
//! cutoff on the vault clock. This is not an observed generation instant.
use chrono::{DateTime, TimeDelta, Utc};

/// Assumed pairwise provider/vault clock bound.
pub(crate) const MARGIN: TimeDelta = TimeDelta::seconds(2);
const NANOS_PER_MILLI: i64 = 1_000_000;

/// The conservative cutoff `E`, or `None` when the bracket is inverted, the
/// period invalid, or the expanded interval spans a window boundary.
pub(crate) fn window_cutoff(
    t0: DateTime<Utc>,
    t1: DateTime<Utc>,
    period_seconds: u32,
) -> Option<DateTime<Utc>> {
    if t1 < t0 {
        return None;
    }
    let period = TimeDelta::seconds(i64::from(period_seconds));
    if period <= MARGIN.checked_mul(2)? {
        return None;
    }
    let period_nanos = period.num_nanoseconds()?;
    let lower = t0.checked_sub_signed(MARGIN)?.timestamp_nanos_opt()?;
    let upper = t1.checked_add_signed(MARGIN)?.timestamp_nanos_opt()?;
    let window = lower.div_euclid(period_nanos);
    if upper.div_euclid(period_nanos) != window {
        return None;
    }
    let end = window.checked_add(1)?.checked_mul(period_nanos)?;
    Some(DateTime::from_timestamp_nanos(end).checked_sub_signed(MARGIN)?)
}

/// Whole milliseconds from `now` until `cutoff`, rounded down; `None` unless
/// positive and at most one period.
pub(crate) fn valid_for_ms(
    cutoff: DateTime<Utc>,
    now: DateTime<Utc>,
    period_seconds: u32,
) -> Option<u64> {
    let remaining = cutoff.signed_duration_since(now).num_nanoseconds()?;
    let milliseconds = u64::try_from(remaining.div_euclid(NANOS_PER_MILLI)).ok()?;
    if milliseconds == 0 || milliseconds > u64::from(period_seconds) * 1000 {
        return None;
    }
    Some(milliseconds)
}
