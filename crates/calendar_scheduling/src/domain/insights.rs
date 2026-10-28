//! Calendar-local booking statistics with the same definitions as the settings UI.
use super::{models::*, ports::*, service::Service};
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// Inclusive local dates and optional booking/host filters.
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InsightQuery {
    /// First local date, inclusive.
    pub from: NaiveDate,
    /// Last local date, inclusive; maximum 366 days.
    pub to: NaiveDate,
    /// IANA zone used for dates and hour-of-day grouping.
    #[cfg_attr(feature = "ai_tools", schemars(with = "String"))]
    pub time_zone: Tz,
    /// Restrict to one booking link; omit for all links.
    pub event_type_id: Option<Uuid>,
    /// Restrict to one assigned host; omit for all hosts.
    pub host_id: Option<String>,
}
/// Counts can overlap: a rescheduled event can also be completed or cancelled.
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightCounts {
    /// All bookings except failed and processing requests.
    pub total: u32,
    /// Confirmed, ended bookings excluding explicit no-shows.
    pub completed: u32,
    /// Bookings with at least one completed reschedule, counted once.
    pub rescheduled: u32,
    /// Cancelled bookings, grouped by their scheduled start.
    pub cancelled: u32,
    /// Explicit guest no-shows only.
    pub guest_no_show: u32,
    /// Explicit host no-shows only.
    pub host_no_show: u32,
}
impl InsightCounts {
    fn add(&mut self, b: &Booking, now: DateTime<Utc>) -> bool {
        let completed = b.status == BookingStatus::Confirmed
            && b.ends_at <= now
            && !matches!(
                b.attendance,
                BookingAttendance::GuestNoShow | BookingAttendance::HostNoShow
            );
        self.total += 1;
        self.completed += u32::from(completed);
        self.rescheduled += u32::from(b.reschedule_count > 0);
        self.cancelled += u32::from(b.status == BookingStatus::Cancelled);
        self.guest_no_show += u32::from(b.attendance == BookingAttendance::GuestNoShow);
        self.host_no_show += u32::from(b.attendance == BookingAttendance::HostNoShow);
        completed
    }
}
/// One complete period of metrics and chart data, with no guest contact information.
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightPeriod {
    /// Summary event counts.
    pub counts: InsightCounts,
    /// Scheduled minutes of completed meetings, not actual call duration.
    pub meeting_minutes: f64,
    /// Average scheduled duration of all confirmed bookings, including future ones.
    pub average_minutes: f64,
    /// Local-date counts, including dates with zero bookings.
    pub days: BTreeMap<NaiveDate, InsightCounts>,
    /// Booking counts by local hour, indexed from 0 to 23.
    pub hours: Vec<u32>,
    /// Booking counts by link identity.
    pub event_counts: BTreeMap<Uuid, u32>,
    /// Booking counts by host; collective bookings count once for each host.
    pub host_counts: BTreeMap<String, u32>,
}
/// Current and equally long preceding local-calendar periods.
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingInsights {
    /// Time at which completion was evaluated.
    pub as_of: DateTime<Utc>,
    /// Preceding period's first local date.
    pub previous_from: NaiveDate,
    /// Preceding period's last local date.
    pub previous_to: NaiveDate,
    /// Requested period.
    pub current: InsightPeriod,
    /// Comparison period, using identical filters and definitions.
    pub previous: InsightPeriod,
}
fn period(
    bookings: &[Booking],
    query: &InsightQuery,
    from: NaiveDate,
    to: NaiveDate,
    now: DateTime<Utc>,
) -> InsightPeriod {
    let mut result = InsightPeriod {
        hours: vec![0; 24],
        ..Default::default()
    };
    let mut date = from;
    while date <= to {
        result.days.insert(date, InsightCounts::default());
        let Some(next) = date.succ_opt() else { break };
        date = next;
    }
    let mut duration = 0.;
    let mut confirmed = 0u32;
    for b in bookings {
        if matches!(b.status, BookingStatus::Failed | BookingStatus::Processing)
            || query.event_type_id.is_some_and(|id| id != b.event_type_id)
            || query
                .host_id
                .as_ref()
                .is_some_and(|id| !b.hosts.contains(id))
        {
            continue;
        }
        let local = b.starts_at.with_timezone(&query.time_zone);
        let Some(day) = result.days.get_mut(&local.date_naive()) else {
            continue;
        };
        day.add(b, now);
        let completed = result.counts.add(b, now);
        result.hours[local.hour() as usize] += 1;
        *result.event_counts.entry(b.event_type_id).or_default() += 1;
        for host in b.hosts.iter().collect::<BTreeSet<_>>() {
            *result.host_counts.entry(host.clone()).or_default() += 1;
        }
        let minutes = ((b.ends_at - b.starts_at).num_milliseconds() as f64 / 60_000.).max(0.);
        if completed {
            result.meeting_minutes += minutes;
        }
        if b.status == BookingStatus::Confirmed {
            duration += minutes;
            confirmed += 1;
        }
    }
    if confirmed > 0 {
        result.average_minutes = duration / f64::from(confirmed);
    }
    result
}
impl<R: Repository, C: Calendars, D: Directory> Service<R, C, D> {
    /// Read complete authorized statistics; never silently truncate bookings.
    pub async fn booking_insights(
        &self,
        user: &str,
        team: Option<Uuid>,
        query: InsightQuery,
    ) -> Result<BookingInsights, Error> {
        let days = (query.to - query.from).num_days() + 1;
        if !(1..=366).contains(&days) {
            return Err(Error::Invalid(
                "Choose an inclusive date range of 1 to 366 days".into(),
            ));
        }
        let invalid_date =
            || Error::Invalid("Choose dates within the supported calendar range".into());
        let previous_from = query
            .from
            .checked_sub_signed(Duration::days(days))
            .ok_or_else(invalid_date)?;
        let previous_to = query.from.pred_opt().ok_or_else(invalid_date)?;
        // A padded UTC read also covers zones with ambiguous or skipped local midnight.
        // Period grouping below uses the requested IANA zone and exact local dates.
        let start = Utc
            .from_utc_datetime(
                &previous_from
                    .and_hms_opt(0, 0, 0)
                    .ok_or_else(invalid_date)?,
            )
            .checked_sub_signed(Duration::days(1))
            .ok_or_else(invalid_date)?;
        let end = Utc
            .from_utc_datetime(&query.to.and_hms_opt(0, 0, 0).ok_or_else(invalid_date)?)
            .checked_add_signed(Duration::days(2))
            .ok_or_else(invalid_date)?;
        // Split the padded read to preserve the existing 733-day per-read limit.
        let midpoint = start + (end - start) / 2;
        let mut bookings = self.bookings_in_range(user, team, start, midpoint).await?;
        bookings.extend(self.bookings_in_range(user, team, midpoint, end).await?);
        let now = Utc::now();
        Ok(BookingInsights {
            as_of: now,
            previous_from,
            previous_to,
            current: period(&bookings, &query, query.from, query.to, now),
            previous: period(&bookings, &query, previous_from, previous_to, now),
        })
    }
}

#[cfg(test)]
mod test;
