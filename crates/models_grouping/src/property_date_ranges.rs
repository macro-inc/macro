//! Frozen, caller-defined buckets for DATE property queries.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Maximum number of date ranges in one grouping request.
pub const MAX_DATE_RANGES: usize = 32;
/// Maximum UTF-8 byte length of a caller-supplied bucket key.
pub const MAX_DATE_RANGE_KEY_BYTES: usize = 128;

/// A half-open UTC interval. An absent start or end extends to infinity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyDateRange {
    /// Unique caller-supplied group key.
    pub key: String,
    /// Inclusive start, or negative infinity.
    pub start: Option<DateTime<Utc>>,
    /// Exclusive end, or positive infinity.
    pub end: Option<DateTime<Utc>>,
}

/// A complete partition of present dates plus one bucket for absent values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyDateRanges {
    /// Ordered, contiguous ranges covering every present date.
    pub ranges: Vec<PropertyDateRange>,
    /// Caller-supplied group key for entities with no date value.
    pub missing_value_bucket_key: String,
}

/// Why a date-range grouping configuration cannot partition all values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropertyDateRangeError {
    /// A partition must contain between one and 32 intervals.
    RangeCount,
    /// Keys must be unique, nonempty and at most 128 bytes long.
    InvalidKey,
    /// The first range must begin at negative infinity and the last must end at positive infinity.
    UnboundedEdges,
    /// Intermediate boundaries must be finite, contiguous and strictly increasing.
    InvalidBounds,
}

impl PropertyDateRanges {
    /// Check that every present date belongs to exactly one bucket.
    pub fn validate(&self) -> Result<(), PropertyDateRangeError> {
        if !(1..=MAX_DATE_RANGES).contains(&self.ranges.len()) {
            return Err(PropertyDateRangeError::RangeCount);
        }
        let mut keys = HashSet::with_capacity(self.ranges.len() + 1);
        for key in self
            .ranges
            .iter()
            .map(|range| range.key.as_str())
            .chain(std::iter::once(self.missing_value_bucket_key.as_str()))
        {
            if key.is_empty()
                || key.contains('\0')
                || key.len() > MAX_DATE_RANGE_KEY_BYTES
                || !keys.insert(key)
            {
                return Err(PropertyDateRangeError::InvalidKey);
            }
        }
        if self
            .ranges
            .first()
            .is_none_or(|range| range.start.is_some())
            || self.ranges.last().is_none_or(|range| range.end.is_some())
        {
            return Err(PropertyDateRangeError::UnboundedEdges);
        }
        for (index, range) in self.ranges.iter().enumerate() {
            if let (Some(start), Some(end)) = (range.start, range.end)
                && start >= end
            {
                return Err(PropertyDateRangeError::InvalidBounds);
            }
            if let Some(next) = self.ranges.get(index + 1)
                && (range.end.is_none() || range.end != next.start)
            {
                return Err(PropertyDateRangeError::InvalidBounds);
            }
        }
        Ok(())
    }

    /// Return the caller's key for a date or its missing-value bucket.
    /// Reject invalid configurations instead of assigning unmatched dates to the missing bucket.
    pub fn key(&self, value: Option<DateTime<Utc>>) -> Result<&str, PropertyDateRangeError> {
        self.validate()?;
        let Some(value) = value else {
            return Ok(&self.missing_value_bucket_key);
        };
        self.ranges
            .iter()
            .find(|range| {
                range.start.is_none_or(|start| value >= start)
                    && range.end.is_none_or(|end| value < end)
            })
            .map(|range| range.key.as_str())
            .ok_or(PropertyDateRangeError::InvalidBounds)
    }
}

#[cfg(test)]
mod test;
