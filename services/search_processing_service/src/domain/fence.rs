//! The version that orders an entity's search index writes.

use rootcause::Report;

/// Orders one entity's index writes: each writer's version is later than
/// every earlier writer's, because it is the time the database granted that
/// writer's lease on the entity. The index refuses a write older than the
/// version it holds, so a delayed write from an earlier writer cannot
/// overwrite or undelete what a later one wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProjectionVersion(u64);

impl ProjectionVersion {
    /// Microseconds since the epoch at the lease grant.
    pub fn from_grant(granted_at: chrono::DateTime<chrono::Utc>) -> Result<Self, Report> {
        Ok(Self(u64::try_from(granted_at.timestamp_micros())?))
    }

    pub fn get(self) -> u64 {
        self.0
    }
}
