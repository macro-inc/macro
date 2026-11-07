//! Date-range value type shared across all layers.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A span of time from `start` to `end`, both included. The end is never
/// before the start: a range that would end earlier does not deserialize.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(try_from = "DateRangeFields")]
pub struct DateRange {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

/// A range ends before it starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("A date range cannot end before it starts")]
pub struct EndsBeforeStart;

impl DateRange {
    /// The range from `start` to `end`, or `EndsBeforeStart`.
    pub fn new(start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Self, EndsBeforeStart> {
        if end < start {
            return Err(EndsBeforeStart);
        }
        Ok(Self { start, end })
    }

    /// The range of one instant.
    pub fn at(instant: DateTime<Utc>) -> Self {
        Self {
            start: instant,
            end: instant,
        }
    }

    /// Where it starts.
    pub fn start(&self) -> DateTime<Utc> {
        self.start
    }

    /// Where it ends.
    pub fn end(&self) -> DateTime<Utc> {
        self.end
    }
}

#[derive(Deserialize)]
struct DateRangeFields {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

impl TryFrom<DateRangeFields> for DateRange {
    type Error = EndsBeforeStart;

    fn try_from(fields: DateRangeFields) -> Result<Self, Self::Error> {
        DateRange::new(fields.start, fields.end)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn a_range_ending_before_it_starts_does_not_deserialize() {
        let backwards: Result<DateRange, _> = serde_json::from_str(
            r#"{"start":"2026-03-02T00:00:00Z","end":"2026-03-01T00:00:00Z"}"#,
        );
        assert!(backwards.is_err());

        let one_day: DateRange = serde_json::from_str(
            r#"{"start":"2026-03-01T00:00:00Z","end":"2026-03-01T00:00:00Z"}"#,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_string(&one_day).unwrap(),
            r#"{"start":"2026-03-01T00:00:00Z","end":"2026-03-01T00:00:00Z"}"#
        );
    }
}
