//! A span of time, the value of a date-range column.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use nom::bytes::complete::is_not;
use nom::character::complete::char;
use nom::combinator::all_consuming;
use nom::sequence::separated_pair;
use nom::{IResult, Parser};
use serde::{Deserialize, Serialize};

/// A span of time from `start` to `end`, both included. A write whose end
/// comes before its start is refused.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub struct DateRange {
    /// Where it starts.
    pub start: DateTime<Utc>,
    /// Where it ends; never before the start.
    pub end: DateTime<Utc>,
}

impl DateRange {
    /// Whether the range ends no earlier than it starts.
    pub fn is_ordered(&self) -> bool {
        self.start <= self.end
    }

    /// How the range stands to an instant: `Less` when it ends before it,
    /// `Greater` when it starts after it, and `Equal` when it contains it.
    /// Comparing a range to a date reads this way everywhere: `=` contains,
    /// `<` ends before, `<=` starts on or before, `>` starts after, `>=`
    /// ends on or after.
    pub fn compare_to(&self, instant: DateTime<Utc>) -> std::cmp::Ordering {
        if self.end < instant {
            std::cmp::Ordering::Less
        } else if self.start > instant {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    }

    /// `start/end`, an ISO 8601 interval with each end read by `instant`.
    /// `None` when the text is not two ends around one `/`, an end does not
    /// read, or the range ends before it starts.
    pub fn parse_interval(
        text: &str,
        instant: impl Fn(&str) -> Option<DateTime<Utc>>,
    ) -> Option<DateRange> {
        let parsed: IResult<&str, (&str, &str)> =
            all_consuming(separated_pair(is_not("/"), char('/'), is_not("/"))).parse(text);
        let (_, (start, end)) = parsed.ok()?;
        let range = DateRange {
            start: instant(start)?,
            end: instant(end)?,
        };
        range.is_ordered().then_some(range)
    }

    /// The range as ISO 8601 writes an interval: `start/end`.
    pub fn iso(&self) -> String {
        format!(
            "{}/{}",
            self.start
                .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true),
            self.end
                .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
        )
    }
}
