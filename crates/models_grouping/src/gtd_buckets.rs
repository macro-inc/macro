//! Forward-looking due-date buckets: Today, Upcoming, Later, Backlog.
//!
//! Distinct from [`crate::date_buckets`], which buckets an entity's *activity*
//! timestamp backwards (Today / Yesterday / Last week) to answer "what did I
//! touch recently". These buckets read a **due date** forwards to answer "what
//! do I have to do", which is the Asana "My Tasks" model.
//!
//! # Where the boundaries come from
//!
//! The two boundaries — end of the viewer's today, and end of the upcoming
//! horizon — are computed **here, in Rust**, not in SQL. Two reasons:
//!
//! 1. `CURRENT_DATE` is the database server's date (UTC in every deployment).
//!    A task due 23:00 local would land a bucket early or late for anyone west
//!    of Greenwich, which is a visible bug rather than a rounding detail.
//! 2. The grouping expression is interpolated into the query as raw SQL (see
//!    `soup::outbound::pg_soup_repo::grouping`), which has no room to bind a
//!    timezone parameter. Formatting the boundaries ourselves keeps the
//!    interpolated text a fixed `[0-9T:-]` shape with no injection surface.
//!
//! # Why the comparison is textual
//!
//! Property values live in `entity_properties.values` as JSONB, so a due date
//! reads out as `values->>'value'` — text. Casting it (`::timestamptz`) is
//! only *stable*, not immutable, so Postgres will not accept an index on the
//! cast expression; comparing the text directly keeps a plain B-tree usable.
//!
//! [`PropertyValue::Date`][pv] serializes from a `DateTime<Utc>`, giving
//! Z-suffixed RFC 3339, and those strings compare lexicographically in
//! chronological order. One subtlety governs [`boundary_prefix`]: the boundary
//! text deliberately **omits the trailing `Z`**. Fractional seconds otherwise
//! invert the comparison at an exact boundary, because `'.' (0x2E) < 'Z'
//! (0x5A)`:
//!
//! ```text
//! "2026-08-13T00:00:00.000Z" < "2026-08-13T00:00:00Z"   -- true, and WRONG
//! "2026-08-13T00:00:00.000Z" < "2026-08-13T00:00:00"    -- false, correct
//! ```
//!
//! Against the bare prefix, any value in that same second sorts *after* it
//! (same prefix, longer string), so midnight-exact due dates fall on the later
//! side of the boundary — which is what "due tomorrow" means.
//!
//! [pv]: https://docs.rs/models_properties

use chrono::{DateTime, Days, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;

/// Bucket keys. Stable identifiers — they appear in API responses, in
/// collapse state persisted by the client, and (from the placement work) in a
/// database column.
pub mod gtd_keys {
    /// Due today or overdue.
    pub const TODAY: &str = "today";
    /// Due within the horizon after today.
    pub const UPCOMING: &str = "upcoming";
    /// Due beyond the horizon.
    pub const LATER: &str = "later";
    /// No due date.
    pub const BACKLOG: &str = "backlog";
}

/// Days after today that count as Upcoming. Matches Asana's default.
pub const DEFAULT_HORIZON_DAYS: u16 = 7;

/// Urgency rank, ascending: lower is more urgent.
///
/// This doubles as the group display order and as the ordering used to resolve
/// a manual placement against the date-derived bucket (the more urgent of the
/// two wins). Unknown keys rank last so a stale or hand-written key degrades
/// to the bottom of the list rather than the top.
pub fn gtd_bucket_rank(key: &str) -> i32 {
    match key {
        gtd_keys::TODAY => 0,
        gtd_keys::UPCOMING => 1,
        gtd_keys::LATER => 2,
        _ => 3,
    }
}

/// Bucket key for a rank, inverse of [`gtd_bucket_rank`].
pub fn gtd_bucket_for_rank(rank: i32) -> &'static str {
    match rank {
        0 => gtd_keys::TODAY,
        1 => gtd_keys::UPCOMING,
        2 => gtd_keys::LATER,
        _ => gtd_keys::BACKLOG,
    }
}

/// Display order for a bucket (lower = first).
pub fn gtd_bucket_order(key: &str) -> i32 {
    gtd_bucket_rank(key)
}

/// Human-readable label for a bucket.
pub fn gtd_bucket_label(key: &str) -> &'static str {
    match key {
        gtd_keys::TODAY => "Today",
        gtd_keys::UPCOMING => "Upcoming",
        gtd_keys::LATER => "Later",
        _ => "Backlog",
    }
}

/// The instants separating the buckets, for one viewer at one moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GtdBoundaries {
    /// First instant that is no longer "today" for the viewer.
    pub today_end: DateTime<Utc>,
    /// First instant that is no longer within the upcoming horizon.
    pub horizon_end: DateTime<Utc>,
}

/// Resolve a local midnight to a UTC instant.
///
/// Midnight is not guaranteed to exist or to be unique: a zone that shifts its
/// clock at midnight (Cuba, and Chile historically) either skips 00:00 or
/// repeats it. Prefer the earliest valid reading of the wall clock; when the
/// hour was skipped entirely, walk forward until the clock exists, which is the
/// first real instant of that local day.
fn local_midnight_utc(tz: Tz, date: NaiveDate) -> DateTime<Utc> {
    let midnight = date.and_time(NaiveTime::MIN);

    if let Some(resolved) = tz.from_local_datetime(&midnight).earliest() {
        return resolved.with_timezone(&Utc);
    }

    // Skipped hour: step through the local day for the first instant that maps.
    for hour in 1..=23 {
        let candidate = date
            .and_hms_opt(hour, 0, 0)
            .expect("hour in 1..=23 is valid");
        if let Some(resolved) = tz.from_local_datetime(&candidate).earliest() {
            return resolved.with_timezone(&Utc);
        }
    }

    // No local time on this date resolves, which no real zone does. Treating
    // the day as starting at UTC midnight keeps bucketing total.
    Utc.from_utc_datetime(&midnight)
}

/// Compute the bucket boundaries for a viewer in `tz` at `now`.
///
/// `now` is taken as a parameter rather than read from the clock so the
/// boundaries are testable and so one request buckets every row against a
/// single consistent moment.
pub fn gtd_boundaries(now: DateTime<Utc>, tz: Tz, horizon_days: u16) -> GtdBoundaries {
    let local_today = now.with_timezone(&tz).date_naive();
    let tomorrow = local_today
        .checked_add_days(Days::new(1))
        .unwrap_or(local_today);
    let horizon = local_today
        .checked_add_days(Days::new(1 + u64::from(horizon_days)))
        .unwrap_or(tomorrow);

    GtdBoundaries {
        today_end: local_midnight_utc(tz, tomorrow),
        horizon_end: local_midnight_utc(tz, horizon),
    }
}

/// Format a boundary as the ISO-8601 prefix used for text comparison.
///
/// Deliberately without a trailing `Z` — see the module documentation. Only
/// ever emits `[0-9T:-]`, which is what makes it safe to interpolate into SQL.
pub fn boundary_prefix(ts: DateTime<Utc>) -> String {
    ts.format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Bucket a due date in Rust, mirroring [`gtd_bucket_sql_key`].
///
/// Used for the equivalence tests that keep the two implementations honest,
/// and by callers that already hold the value.
pub fn compute_gtd_bucket(due: Option<DateTime<Utc>>, boundaries: &GtdBoundaries) -> &'static str {
    match due {
        None => gtd_keys::BACKLOG,
        Some(due) if due < boundaries.today_end => gtd_keys::TODAY,
        Some(due) if due < boundaries.horizon_end => gtd_keys::UPCOMING,
        Some(_) => gtd_keys::LATER,
    }
}

/// SQL `CASE` yielding the bucket key from a **text** due-date expression.
///
/// `due_text_expr` must evaluate to RFC 3339 text or NULL (typically
/// `ep_due.due_text`, i.e. `values->>'value'`).
///
/// # Example
/// ```
/// use chrono::{TimeZone, Utc};
/// use models_grouping::{gtd_boundaries, gtd_bucket_sql_key, DEFAULT_HORIZON_DAYS};
///
/// let now = Utc.with_ymd_and_hms(2026, 8, 12, 15, 0, 0).unwrap();
/// let b = gtd_boundaries(now, chrono_tz::UTC, DEFAULT_HORIZON_DAYS);
/// let sql = gtd_bucket_sql_key("ep_due.due_text", &b);
/// assert!(sql.contains("'today'"));
/// assert!(sql.contains("2026-08-13T00:00:00"));
/// ```
pub fn gtd_bucket_sql_key(due_text_expr: &str, boundaries: &GtdBoundaries) -> String {
    let today_end = boundary_prefix(boundaries.today_end);
    let horizon_end = boundary_prefix(boundaries.horizon_end);
    format!(
        r#"CASE
    WHEN {due_text_expr} IS NULL THEN 'backlog'
    WHEN {due_text_expr} < '{today_end}' THEN 'today'
    WHEN {due_text_expr} < '{horizon_end}' THEN 'upcoming'
    ELSE 'later'
END"#
    )
}

/// SQL `CASE` yielding the bucket display order, matching [`gtd_bucket_order`].
pub fn gtd_bucket_sql_order(due_text_expr: &str, boundaries: &GtdBoundaries) -> String {
    let today_end = boundary_prefix(boundaries.today_end);
    let horizon_end = boundary_prefix(boundaries.horizon_end);
    format!(
        r#"CASE
    WHEN {due_text_expr} IS NULL THEN 3
    WHEN {due_text_expr} < '{today_end}' THEN 0
    WHEN {due_text_expr} < '{horizon_end}' THEN 1
    ELSE 2
END"#
    )
}

#[cfg(test)]
mod test;
