//! In-memory cache revision values and revision-qualified observations.

#[cfg(test)]
mod test;

use std::fmt;
use std::ops::Deref;
use std::str::FromStr;
use thiserror::Error;

/// Opaque revision of one live cache engine's effective view.
///
/// Revisions are meaningful only within one engine generation. Consumers
/// should compare them for equality and must discard them when the engine is
/// replaced.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CacheRevision(u64);

impl CacheRevision {
    /// The initial revision of every newly created engine.
    pub const ZERO: Self = Self(0);

    pub(crate) fn checked_successor(self) -> Option<Self> {
        self.0.checked_add(1).map(Self)
    }
}

impl fmt::Display for CacheRevision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Error returned when parsing a cache revision from its wire representation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ParseCacheRevisionError {
    /// The input was not a canonical unsigned decimal integer.
    #[error("cache revision must be a canonical unsigned decimal integer")]
    Invalid,
    /// The input exceeded the unsigned 64-bit revision range.
    #[error("cache revision exceeds the unsigned 64-bit range")]
    Overflow,
}

impl FromStr for CacheRevision {
    type Err = ParseCacheRevisionError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.is_empty()
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(ParseCacheRevisionError::Invalid);
        }
        value
            .parse::<u64>()
            .map(Self)
            .map_err(|_| ParseCacheRevisionError::Overflow)
    }
}

/// A value observed from one exact cache-engine revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Revisioned<T> {
    /// Revision installed in the engine when `value` was observed.
    pub revision: CacheRevision,
    /// The observed value.
    pub value: T,
}

impl<T> Deref for Revisioned<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.value
    }
}

impl<T: PartialEq> PartialEq<T> for Revisioned<T> {
    fn eq(&self, other: &T) -> bool {
        self.value.eq(other)
    }
}
