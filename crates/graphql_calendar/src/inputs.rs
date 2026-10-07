use async_graphql::{ID, InputObject};
use calendar_events::domain::{
    changes::{CalendarLinkWatermark, CalendarWatermark},
    models::{CalendarOccurrenceCursor, OccurrenceRange},
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use graphql_common::parse_id;
use models_pagination::Base64Str;

use crate::bad_input;

#[cfg(test)]
mod test;

/// Largest page `calendarOccurrences` returns.
const MAX_PAGE_SIZE: u16 = 2000;
/// Page size when `first` is omitted.
const DEFAULT_PAGE_SIZE: u16 = 1000;

/// A bounded occurrence viewport and page request.
#[derive(InputObject, Clone, Debug)]
pub struct CalendarRangeInput {
    /// Inclusive UTC viewport start in RFC 3339 format.
    pub start: String,
    /// Exclusive UTC viewport end in RFC 3339 format.
    pub end: String,
    /// Inclusive local date boundary for all-day events (`YYYY-MM-DD`).
    /// Defaults to the date of `start`.
    pub start_date: Option<String>,
    /// Exclusive local date boundary for all-day events (`YYYY-MM-DD`).
    /// Defaults to the first date at or after `end`.
    pub end_date: Option<String>,
    /// Page size, from 1 through 2,000. Defaults to 1,000.
    pub first: Option<i32>,
    /// `endCursor` of the previous page.
    pub after: Option<String>,
}

/// A validated occurrence page request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OccurrencePageRequest {
    pub(crate) range: OccurrenceRange,
    pub(crate) cursor: Option<CalendarOccurrenceCursor>,
    pub(crate) page_size: u16,
}

impl CalendarRangeInput {
    pub(crate) fn into_page_request(self) -> async_graphql::Result<OccurrencePageRequest> {
        let starts_at = parse_instant(&self.start, "start")?;
        let ends_at = parse_instant(&self.end, "end")?;
        let start_date = match self.start_date {
            Some(value) => parse_date(&value, "startDate")?,
            None => starts_at.date_naive(),
        };
        let end_date = match self.end_date {
            Some(value) => parse_date(&value, "endDate")?,
            None => default_end_date(ends_at)
                .ok_or_else(|| bad_input("calendar end is outside the supported date range"))?,
        };
        Ok(OccurrencePageRequest {
            range: OccurrenceRange {
                starts_at,
                ends_at,
                start_date,
                end_date,
            },
            cursor: self.after.map(decode_cursor).transpose()?,
            page_size: page_size(self.first)?,
        })
    }
}

pub(crate) fn encode_cursor(cursor: CalendarOccurrenceCursor) -> String {
    Base64Str::encode_json(cursor).type_erase()
}

fn decode_cursor(cursor: String) -> async_graphql::Result<CalendarOccurrenceCursor> {
    Base64Str::new_from_string(cursor)
        .decode_json()
        .map_err(|_| bad_input("calendar cursor is invalid"))
}

fn page_size(first: Option<i32>) -> async_graphql::Result<u16> {
    let Some(first) = first else {
        return Ok(DEFAULT_PAGE_SIZE);
    };
    u16::try_from(first)
        .ok()
        .filter(|size| (1..=MAX_PAGE_SIZE).contains(size))
        .ok_or_else(|| bad_input("calendar page size must be between 1 and 2000"))
}

fn parse_instant(value: &str, field: &str) -> async_graphql::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|instant| instant.with_timezone(&Utc))
        .map_err(|_| bad_input(format!("{field} must be an RFC 3339 instant")))
}

fn parse_date(value: &str, field: &str) -> async_graphql::Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| bad_input(format!("{field} must be a YYYY-MM-DD date")))
}

/// The all-day boundary that covers every instant before `end`: its own date
/// at midnight, else the following date.
fn default_end_date(end: DateTime<Utc>) -> Option<NaiveDate> {
    if end.time() == NaiveTime::MIN {
        Some(end.date_naive())
    } else {
        end.date_naive().succ_opt()
    }
}

/// How far the client has applied one connected inbox's change log.
#[derive(InputObject, Clone, Debug)]
pub struct CalendarLinkWatermarkInput {
    /// Connected inbox identifier.
    pub link_id: ID,
    /// Last applied sequence, as the decimal string the server returned.
    pub seq: String,
}

/// A request for calendar changes after a watermark.
#[derive(InputObject, Clone, Debug)]
pub struct CalendarChangesInput {
    /// The client's watermark, one entry per tracked connected inbox. Empty
    /// returns only the current watermark.
    pub since: Vec<CalendarLinkWatermarkInput>,
}

impl CalendarChangesInput {
    pub(crate) fn into_watermark(self) -> async_graphql::Result<CalendarWatermark> {
        let links = self
            .since
            .into_iter()
            .map(|link| {
                let link_id = parse_id(link.link_id, "since.linkId")
                    .map_err(|_| bad_input("since.linkId must be a UUID"))?;
                let seq = link
                    .seq
                    .parse::<i64>()
                    .ok()
                    .filter(|seq| *seq >= 0)
                    .ok_or_else(|| bad_input("since.seq must be a non-negative integer"))?;
                Ok(CalendarLinkWatermark { link_id, seq })
            })
            .collect::<async_graphql::Result<Vec<_>>>()?;
        Ok(CalendarWatermark::from_links(links))
    }
}
