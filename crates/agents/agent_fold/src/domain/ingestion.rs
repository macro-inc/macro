//! Reconcile a durable effective-history snapshot with overlapping live rows.
//!
//! Row identity is not ACP identity: distinct rows may intentionally replay the
//! same protocol content. Only snapshot row IDs and rows before its inclusive
//! history boundary are excluded. Live rows retain delivery order.

use super::fold::FoldMachineImpl;
use super::log::AgentSessionLog;
use super::model::FoldEvent;
use super::ports::FoldMachine;
use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use serde::Deserialize;
use std::collections::HashSet;

#[cfg(test)]
mod test;

/// Repository ordering key, preserving Postgres submillisecond precision.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct LogCursor {
    /// Durable insertion timestamp, compared before the row ID.
    pub created_at: DateTime<Utc>,
    /// Durable row identity and equal-timestamp tie breaker.
    pub id: Uuid,
}

/// One snapshot-backed fold. Retained reconciliation state is bounded by the
/// snapshot size; following a long-running stream never grows an ID cache.
#[derive(Default)]
pub struct LogIngestion {
    /// The append-only protocol machine, also usable without durable metadata.
    pub machine: FoldMachineImpl,
    boundary: Option<LogCursor>,
    snapshot_ids: HashSet<Uuid>,
}

impl LogIngestion {
    /// Replace the machine with an authoritative snapshot in repository order.
    pub fn replace_snapshot(&mut self, rows: Vec<(LogCursor, AgentSessionLog)>) {
        self.machine = FoldMachineImpl::new();
        self.boundary = rows.first().map(|(cursor, _)| *cursor);
        self.snapshot_ids = rows.iter().map(|(cursor, _)| cursor.id).collect();
        for (_, row) in rows {
            let _ = self.machine.push(row);
        }
    }

    /// Append a live row unless already represented or excluded by the snapshot.
    /// Never compare against a moving high-water mark: live delivery order is
    /// authoritative, and a late distinct row must not disappear.
    pub fn push(&mut self, cursor: LogCursor, row: AgentSessionLog) -> Vec<FoldEvent<'_>> {
        if self.boundary.is_some_and(|boundary| cursor < boundary)
            || self.snapshot_ids.contains(&cursor.id)
        {
            return Vec::new();
        }
        self.machine.push(row)
    }
}
