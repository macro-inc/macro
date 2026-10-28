//! A subject's activity summarized over a bounded window of local dates.

#[cfg(test)]
mod test;

use std::num::NonZeroU64;

use chrono::{DateTime, Days, NaiveDate, Utc};
use chrono_tz::Tz;

use super::models::EntityType;

/// Maximum number of local dates an overview window may contain.
pub const MAX_ACTIVITY_WINDOW_DAYS: i64 = 400;

/// Number of entities included in the overview ranking.
pub const TOP_ENTITY_LIMIT: i64 = 8;

/// A half-open span of local dates in one IANA time zone.
///
/// The outbound adapter converts both bounds and day buckets with the same
/// Postgres `AT TIME ZONE` operation. Keeping UTC instants out of this type
/// prevents the filter and its day buckets from choosing different offsets
/// at an ambiguous local midnight.
#[readonly::make]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityWindow {
    /// Zone used to interpret the dates and bucket activity.
    pub zone: Tz,
    /// First local date, inclusive.
    pub start: NaiveDate,
    /// One past the final local date, exclusive.
    pub end: NaiveDate,
}

/// Why an activity window is invalid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityWindowError {
    /// The end is not later than the start.
    Empty,
    /// The window contains more than [`MAX_ACTIVITY_WINDOW_DAYS`] dates.
    TooWide,
}

impl std::fmt::Display for ActivityWindowError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => formatter.write_str("activity window must contain at least one day"),
            Self::TooWide => formatter.write_str("activity window may contain at most 400 days"),
        }
    }
}

impl std::error::Error for ActivityWindowError {}

impl ActivityWindow {
    /// Builds a non-empty activity window containing at most 400 local dates.
    pub fn new(zone: Tz, start: NaiveDate, end: NaiveDate) -> Result<Self, ActivityWindowError> {
        let days = end.signed_duration_since(start).num_days();
        if days <= 0 {
            return Err(ActivityWindowError::Empty);
        }
        if days > MAX_ACTIVITY_WINDOW_DAYS {
            return Err(ActivityWindowError::TooWide);
        }
        Ok(Self { zone, start, end })
    }

    /// Whether `day` belongs to this half-open window.
    pub fn contains(&self, day: NaiveDate) -> bool {
        self.start <= day && day < self.end
    }
}

/// Builds the 365-local-date window ending after the viewer's current date.
pub fn trailing_year(now: DateTime<Utc>, zone: Tz) -> ActivityWindow {
    let today = now.with_timezone(&zone).date_naive();
    let end = today
        .checked_add_days(Days::new(1))
        .expect("a current local date has a following day");
    let start = end
        .checked_sub_days(Days::new(365))
        .expect("a current local date has a preceding year");
    ActivityWindow::new(zone, start, end).expect("the trailing-year window is valid")
}

/// One local date with at least one activity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DayCount {
    /// Local date in the overview's zone.
    pub day: NaiveDate,
    /// Number of activities on that date.
    pub count: NonZeroU64,
}

/// One entity ranked by the number of activities that touched it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityRank {
    /// Kind of entity.
    pub entity_type: EntityType,
    /// Entity identifier.
    pub entity_id: String,
    /// Number of activities that touched the entity.
    pub count: NonZeroU64,
}

/// Why aggregate rows cannot form a valid overview.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityOverviewError {
    /// A day falls outside the overview window.
    DayOutsideWindow,
    /// Day rows are not strictly ascending.
    DaysNotAscending,
    /// Summing the day rows exceeds `u64`.
    TotalOverflow,
    /// More ranked entities were supplied than the product permits.
    TooManyEntities,
    /// Entity rows do not follow the stable ranking order.
    EntitiesNotRanked,
}

impl std::fmt::Display for ActivityOverviewError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DayOutsideWindow => {
                formatter.write_str("activity overview contains a day outside its window")
            }
            Self::DaysNotAscending => {
                formatter.write_str("activity overview days must be strictly ascending")
            }
            Self::TotalOverflow => formatter.write_str("activity overview total exceeds u64"),
            Self::TooManyEntities => {
                formatter.write_str("activity overview contains more than eight entities")
            }
            Self::EntitiesNotRanked => {
                formatter.write_str("activity overview entities are not stably ranked")
            }
        }
    }
}

impl std::error::Error for ActivityOverviewError {}

/// Sparse daily counts and a stable entity ranking over one window.
#[readonly::make]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityOverview {
    /// Window covered by both aggregates.
    pub window: ActivityWindow,
    /// Sparse positive day counts in ascending date order.
    pub days: Vec<DayCount>,
    /// Top entities ordered by count descending, then type and id ascending.
    pub top_entities: Vec<EntityRank>,
}

impl ActivityOverview {
    /// Builds an overview after validating aggregate ordering and bounds.
    pub fn new(
        window: ActivityWindow,
        days: Vec<DayCount>,
        top_entities: Vec<EntityRank>,
    ) -> Result<Self, ActivityOverviewError> {
        let mut previous_day = None;
        let mut total = 0_u64;
        for day in &days {
            if !window.contains(day.day) {
                return Err(ActivityOverviewError::DayOutsideWindow);
            }
            if previous_day.is_some_and(|previous| previous >= day.day) {
                return Err(ActivityOverviewError::DaysNotAscending);
            }
            total = total
                .checked_add(day.count.get())
                .ok_or(ActivityOverviewError::TotalOverflow)?;
            previous_day = Some(day.day);
        }

        if top_entities.len() > TOP_ENTITY_LIMIT as usize {
            return Err(ActivityOverviewError::TooManyEntities);
        }
        if top_entities.windows(2).any(|pair| {
            let left = &pair[0];
            let right = &pair[1];
            left.count < right.count
                || (left.count == right.count
                    && (left.entity_type.as_ref(), left.entity_id.as_str())
                        >= (right.entity_type.as_ref(), right.entity_id.as_str()))
        }) {
            return Err(ActivityOverviewError::EntitiesNotRanked);
        }

        Ok(Self {
            window,
            days,
            top_entities,
        })
    }

    /// Builds an overview with no activity.
    pub fn empty(window: ActivityWindow) -> Self {
        Self {
            window,
            days: Vec::new(),
            top_entities: Vec::new(),
        }
    }

    /// Total activities in the window.
    pub fn total(&self) -> u64 {
        self.days.iter().map(|day| day.count.get()).sum()
    }
}
