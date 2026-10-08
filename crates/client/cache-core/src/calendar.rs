//! Local calendar range projection.
//!
//! Cached occurrence records are projected into compact span rows so a
//! viewport can be answered without decoding every occurrence. A coverage map
//! records which spans were fully fetched from the server, and a per-link
//! change watermark records how far the delta stream has been applied.

mod coverage;
mod watermark;

pub use coverage::{coverage_gaps, merge_spans};
pub use watermark::{
    CalendarLinkWatermark, CalendarWatermarkUpdate, apply_watermark_update, parse_watermark,
    serialize_watermark,
};

use crate::identity::{ALIAS_FIELD, DELETED_FIELD};
use crate::store::Storage;
use crate::value::{CacheValue, EntityKey, Record};
use chrono::NaiveDate;
use maybe_send::MaybeSend;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use thiserror::Error;

/// Normalized typename of one calendar occurrence.
pub const OCCURRENCE_TYPENAME: &str = "GraphqlCalendarOccurrence";
/// Normalized typename of one calendar event.
pub const EVENT_TYPENAME: &str = "GraphqlCalendarEvent";
/// Normalized typename of one visible calendar.
pub const CALENDAR_TYPENAME: &str = "GraphqlCalendar";

const TIMED_TYPENAME: &str = "GraphqlTimedEventTime";
const ALL_DAY_TYPENAME: &str = "GraphqlAllDayEventTime";

/// Revision of the derived range rows. Storage adapters rebuild existing rows
/// from normalized records when this changes; records and coverage stay valid.
pub const CALENDAR_PROJECTION_VERSION: u32 = 2;

/// Maximum number of keys, spans, and links accepted by one commit.
pub const MAX_CALENDAR_COMMIT_ITEMS: usize = 20_000;

const MS_PER_DAY: i64 = 86_400_000;
const SHORT_SPAN_DAYS: i64 = 7;

/// Unit of a calendar span.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalendarSpanKind {
    /// UTC instants in milliseconds since the Unix epoch.
    Timed,
    /// Local dates in days since 1970-01-01.
    AllDay,
}

impl CalendarSpanKind {
    /// Stable value persisted by relational storage.
    pub const fn code(self) -> i64 {
        match self {
            Self::Timed => 0,
            Self::AllDay => 1,
        }
    }

    /// Decodes a persisted kind.
    pub const fn from_code(code: i64) -> Option<Self> {
        match code {
            0 => Some(Self::Timed),
            1 => Some(Self::AllDay),
            _ => None,
        }
    }

    /// Longest span kept on the bounded-start scan path. Longer rows are
    /// scanned separately so a short-span lookup can bound its start column.
    pub const fn max_short_span(self) -> i64 {
        match self {
            Self::Timed => SHORT_SPAN_DAYS * MS_PER_DAY,
            Self::AllDay => SHORT_SPAN_DAYS,
        }
    }
}

/// Half-open `[start, end)` span, or a timed point when both bounds are equal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSpan {
    /// Unit of `start` and `end`.
    pub kind: CalendarSpanKind,
    /// Inclusive start.
    pub start: i64,
    /// Exclusive end.
    pub end: i64,
}

impl CalendarSpan {
    /// Whether spans intersect, including a timed point within a positive span.
    pub fn overlaps(&self, other: &CalendarSpan) -> bool {
        if self.kind != other.kind || self.end < self.start || other.end < other.start {
            return false;
        }
        if self.kind == CalendarSpanKind::Timed {
            if self.start == self.end {
                return other.start <= self.start && self.start < other.end;
            }
            if other.start == other.end {
                return self.start <= other.start && other.start < self.end;
            }
        }
        self.start < self.end
            && other.start < other.end
            && self.start < other.end
            && self.end > other.start
    }
}

/// Compact projection of one cached occurrence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarRangeRow {
    /// Normalized occurrence key.
    pub record_key: EntityKey<'static>,
    /// Normalized key of the owning event.
    pub event_key: EntityKey<'static>,
    /// Email link whose change log owns the occurrence.
    pub link_id: String,
    /// Occurrence span.
    pub span: CalendarSpan,
}

impl CalendarRangeRow {
    /// Whether the row is scanned on the unbounded long-span path.
    pub fn is_long(&self) -> bool {
        self.span.end - self.span.start > self.span.kind.max_short_span()
    }
}

/// Projects a fully merged occurrence record into its range row.
///
/// `None` means the record is not a visible occurrence (another type, deleted,
/// aliased, cancelled, or missing a field the projection needs). Storage
/// deletes any old row in that case, in the same transaction as the record.
pub fn project_calendar_range(key: &EntityKey<'_>, record: &Record) -> Option<CalendarRangeRow> {
    if key.typename() != Some(OCCURRENCE_TYPENAME)
        || matches!(
            record.fields.get(DELETED_FIELD),
            Some(CacheValue::Bool(true))
        )
        || record.fields.contains_key(ALIAS_FIELD)
        || matches!(
            record.fields.get("isCancelled"),
            Some(CacheValue::Bool(true))
        )
    {
        return None;
    }
    let event_id = string_field(record, "eventId")?;
    let link_id = string_field(record, "linkId")?;
    let Some(CacheValue::Object(time)) = record.fields.get("time") else {
        return None;
    };
    let span = project_time(time)?;
    Some(CalendarRangeRow {
        record_key: key.clone().into_owned(),
        event_key: EntityKey::entity(EVENT_TYPENAME, &[event_id]),
        link_id: link_id.to_owned(),
        span,
    })
}

fn project_time(time: &BTreeMap<String, CacheValue>) -> Option<CalendarSpan> {
    let typename = match time.get("__typename") {
        Some(CacheValue::String(typename)) => Some(typename.as_str()),
        _ => None,
    };
    let text = |field: &str| match time.get(field) {
        Some(CacheValue::String(value)) => Some(value.as_str()),
        _ => None,
    };
    let timed = || {
        let start = chrono::DateTime::parse_from_rfc3339(text("startsAt")?).ok()?;
        let end = chrono::DateTime::parse_from_rfc3339(text("endsAt")?).ok()?;
        // Validate before millisecond projection so a reversed sub-millisecond
        // interval cannot round into an apparently valid point.
        (end >= start).then_some(CalendarSpan {
            kind: CalendarSpanKind::Timed,
            start: start.timestamp_millis(),
            end: end.timestamp_millis(),
        })
    };
    let all_day = || {
        Some(CalendarSpan {
            kind: CalendarSpanKind::AllDay,
            start: parse_epoch_day(text("startDate")?)?,
            end: parse_epoch_day(text("endDate")?)?,
        })
    };
    let span = match typename {
        Some(TIMED_TYPENAME) => timed()?,
        Some(ALL_DAY_TYPENAME) => all_day()?,
        Some(_) => return None,
        None => timed().or_else(all_day)?,
    };
    (span.end > span.start || (span.kind == CalendarSpanKind::Timed && span.end == span.start))
        .then_some(span)
}

fn string_field<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field) {
        Some(CacheValue::String(value)) if !value.is_empty() => Some(value),
        _ => None,
    }
}

fn parse_epoch_day(value: &str) -> Option<i64> {
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1)?;
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .map(|date| (date - epoch).num_days())
}

/// Global freshness of the locally applied change stream.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalendarFreshness {
    /// The last delta reached the server's current watermark.
    Fresh,
    /// A change was signalled and has not been applied yet.
    Stale,
    /// No delta has ever been committed.
    #[default]
    Unknown,
}

impl CalendarFreshness {
    /// Stable value persisted by relational storage.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::Stale => "stale",
            Self::Unknown => "unknown",
        }
    }

    /// Decodes a persisted freshness value.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "fresh" => Some(Self::Fresh),
            "stale" => Some(Self::Stale),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }
}

/// One viewport read over both span kinds, optionally limited to one event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRangeRequest {
    /// Inclusive UTC start of timed occurrences, in milliseconds.
    pub start_ms: i64,
    /// Exclusive UTC end of timed occurrences, in milliseconds.
    pub end_ms: i64,
    /// Inclusive local start date of all-day occurrences, in epoch days.
    pub start_day: i64,
    /// Exclusive local end date of all-day occurrences, in epoch days.
    pub end_day: i64,
    /// Restricts occurrences to one `GraphqlCalendarEvent` key.
    #[serde(default)]
    pub event_key: Option<EntityKey<'static>>,
}

impl CalendarRangeRequest {
    /// The requested span of each kind.
    pub fn spans(&self) -> [CalendarSpan; 2] {
        [
            CalendarSpan {
                kind: CalendarSpanKind::Timed,
                start: self.start_ms,
                end: self.end_ms,
            },
            CalendarSpan {
                kind: CalendarSpanKind::AllDay,
                start: self.start_day,
                end: self.end_day,
            },
        ]
    }

    /// Whether a projected row belongs to this request.
    pub fn includes(&self, row: &CalendarRangeRow) -> bool {
        self.event_key
            .as_ref()
            .is_none_or(|event_key| *event_key == row.event_key)
            && self
                .spans()
                .iter()
                .any(|span| span.start < span.end && span.overlaps(&row.span))
    }

    /// Rejects inverted spans and foreign event keys. An empty span is valid
    /// and reads only sync state.
    pub fn validate(&self) -> Result<(), CalendarError> {
        if self.start_ms > self.end_ms || self.start_day > self.end_day {
            return Err(CalendarError::InvalidSpan);
        }
        if self
            .event_key
            .as_ref()
            .is_some_and(|key| key.typename() != Some(EVENT_TYPENAME))
        {
            return Err(CalendarError::InvalidKey);
        }
        Ok(())
    }
}

/// Persisted sync state shared by every range read.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarSyncState {
    /// Applied per-link watermark, or `None` before the first commit carrying one.
    pub watermark: Option<Vec<CalendarLinkWatermark>>,
    /// Freshness of the applied change stream.
    pub freshness: CalendarFreshness,
}

/// Authoritative storage state for one range read, taken in one read transaction.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarRangeSnapshot {
    /// Authoritative rows matching the request.
    pub rows: Vec<CalendarRangeRow>,
    /// Coverage spans that overlap or touch the requested spans.
    pub coverage: Vec<CalendarSpan>,
    /// Persisted sync state.
    pub sync: CalendarSyncState,
}

/// Result of one local range read.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRangeResult {
    /// Effective occurrence keys in the range, ordered by kind, start, and key.
    pub occurrence_keys: Vec<EntityKey<'static>>,
    /// Requested spans that were never fetched from the server.
    pub gaps: Vec<CalendarSpan>,
    /// Freshness of the applied change stream.
    pub freshness: CalendarFreshness,
    /// Events whose effective occurrence set is unknown until a pending
    /// mutation settles (for example a recurrence edit).
    pub uncertain_event_keys: Vec<EntityKey<'static>>,
    /// Whether a pending optimistic mutation shaped this result.
    pub optimistic: bool,
    /// Applied per-link watermark, or `None` before the first commit carrying one.
    pub watermark: Option<Vec<CalendarLinkWatermark>>,
}

/// The complete current occurrence set of one event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarReplacedEvent {
    /// Normalized event key.
    pub event_key: EntityKey<'static>,
    /// Every occurrence key the event currently has. Cached occurrences of the
    /// event outside this set are deleted.
    pub occurrence_keys: Vec<EntityKey<'static>>,
}

/// One atomic change to calendar coverage, cached calendar records, and sync state.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCommit {
    /// Spans whose occurrences were fully fetched and written.
    #[serde(default)]
    pub coverage: Vec<CalendarSpan>,
    /// Events whose occurrence sets are replaced wholesale.
    #[serde(default)]
    pub replaced_events: Vec<CalendarReplacedEvent>,
    /// Events deleted with every cached occurrence.
    #[serde(default)]
    pub deleted_event_keys: Vec<EntityKey<'static>>,
    /// Calendars deleted from the cache.
    #[serde(default)]
    pub deleted_calendar_keys: Vec<EntityKey<'static>>,
    /// Email links no longer visible: their occurrences, events, and calendars are deleted.
    #[serde(default)]
    pub removed_link_ids: Vec<String>,
    /// Watermark change applied after the deletions.
    #[serde(default)]
    pub watermark: Option<CalendarWatermarkUpdate>,
    /// New freshness, `Fresh` or `Stale`.
    #[serde(default)]
    pub freshness: Option<CalendarFreshness>,
    /// Deletes every cached occurrence and event, all coverage, and the
    /// watermark before applying the rest of the commit.
    #[serde(default)]
    pub reset: bool,
}

impl CalendarCommit {
    /// Validates keys, spans, and sync values before storage is touched.
    pub fn validate(&self) -> Result<(), CalendarError> {
        let items = self.coverage.len()
            + self.deleted_event_keys.len()
            + self.deleted_calendar_keys.len()
            + self.removed_link_ids.len()
            + self
                .replaced_events
                .iter()
                .map(|event| event.occurrence_keys.len() + 1)
                .sum::<usize>()
            + self
                .watermark
                .as_ref()
                .map_or(0, CalendarWatermarkUpdate::len);
        if items > MAX_CALENDAR_COMMIT_ITEMS {
            return Err(CalendarError::TooLarge);
        }
        if self.coverage.iter().any(|span| span.start > span.end) {
            return Err(CalendarError::InvalidSpan);
        }
        let is_typed = |key: &EntityKey<'_>, typename| {
            key.typename() == Some(typename) && key.id().is_some_and(|id| !id.is_empty())
        };
        let mut replaced = BTreeSet::new();
        for event in &self.replaced_events {
            if !is_typed(&event.event_key, EVENT_TYPENAME)
                || !replaced.insert(&event.event_key)
                || !event
                    .occurrence_keys
                    .iter()
                    .all(|key| is_typed(key, OCCURRENCE_TYPENAME))
            {
                return Err(CalendarError::InvalidKey);
            }
        }
        if !self
            .deleted_event_keys
            .iter()
            .all(|key| is_typed(key, EVENT_TYPENAME))
            || !self
                .deleted_calendar_keys
                .iter()
                .all(|key| is_typed(key, CALENDAR_TYPENAME))
            || self.removed_link_ids.iter().any(String::is_empty)
        {
            return Err(CalendarError::InvalidKey);
        }
        if self.freshness == Some(CalendarFreshness::Unknown) {
            return Err(CalendarError::InvalidFreshness);
        }
        self.watermark
            .as_ref()
            .map_or(Ok(()), CalendarWatermarkUpdate::validate)
    }
}

/// Sync state after applying `commit` to `stored`.
pub fn next_sync_state(stored: &CalendarSyncState, commit: &CalendarCommit) -> CalendarSyncState {
    let base = if commit.reset {
        CalendarSyncState::default()
    } else {
        stored.clone()
    };
    let watermark = (commit.watermark.is_some() || base.watermark.is_some()).then(|| {
        apply_watermark_update(
            base.watermark.as_deref(),
            commit.watermark.as_ref(),
            &commit.removed_link_ids,
        )
    });
    CalendarSyncState {
        watermark,
        freshness: commit.freshness.unwrap_or(base.freshness),
    }
}

/// Records removed by one calendar commit.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarCommitOutcome {
    /// Normalized records deleted from storage.
    pub deleted_keys: Vec<EntityKey<'static>>,
}

/// Calendar request validation errors.
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum CalendarError {
    /// A span ends before it starts.
    #[error("calendar span ends before it starts")]
    InvalidSpan,
    /// A key does not name the expected calendar typename.
    #[error("invalid calendar cache key")]
    InvalidKey,
    /// A watermark entry is malformed or duplicated.
    #[error("invalid calendar watermark")]
    InvalidWatermark,
    /// Freshness can only be committed as fresh or stale.
    #[error("calendar freshness must be fresh or stale")]
    InvalidFreshness,
    /// The commit exceeds [`MAX_CALENDAR_COMMIT_ITEMS`].
    #[error("calendar commit has more than {MAX_CALENDAR_COMMIT_ITEMS} items")]
    TooLarge,
}

/// Composes authoritative rows with the optimistic overlay.
///
/// `overlay` holds every occurrence key touched by an active optimistic layer,
/// mapped to its effective row (`None` when the effective record is hidden).
/// Overlaid keys replace their authoritative rows. Returns ordered keys and
/// whether the overlay shaped the result.
pub fn compose_calendar_rows(
    request: &CalendarRangeRequest,
    authoritative: Vec<CalendarRangeRow>,
    overlay: &HashMap<EntityKey<'static>, Option<CalendarRangeRow>>,
) -> (Vec<EntityKey<'static>>, bool) {
    let mut optimistic = false;
    let mut rows = Vec::with_capacity(authoritative.len());
    for row in authoritative {
        if overlay.contains_key(&row.record_key) {
            optimistic = true;
        } else {
            rows.push(row);
        }
    }
    for row in overlay.values().flatten() {
        if request.includes(row) {
            optimistic = true;
            rows.push(row.clone());
        }
    }
    rows.sort_by(|left, right| {
        (left.span.kind, left.span.start, &left.record_key).cmp(&(
            right.span.kind,
            right.span.start,
            &right.record_key,
        ))
    });
    rows.dedup_by(|left, right| left.record_key == right.record_key);
    (
        rows.into_iter().map(|row| row.record_key).collect(),
        optimistic,
    )
}

/// Storage capability for the calendar range projection.
///
/// Implementations write range rows in the same transaction as every
/// normalized record write and delete, exactly like search documents.
pub trait CalendarRangeStorage: Storage {
    /// Reads rows, coverage, and sync state for one request in one read transaction.
    fn query_calendar_ranges(
        &self,
        request: &CalendarRangeRequest,
    ) -> impl Future<Output = Result<CalendarRangeSnapshot, Self::Error>> + MaybeSend;

    /// Applies a validated commit in one write transaction.
    fn calendar_commit(
        &mut self,
        commit: &CalendarCommit,
    ) -> impl Future<Output = Result<CalendarCommitOutcome, Self::Error>> + MaybeSend;
}

#[cfg(test)]
mod test;
