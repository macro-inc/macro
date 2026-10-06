//! Appending to the per-link change log inside calendar write transactions.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Utc};
use rootcause::Report;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{PgCalendarRepository, report};
use crate::domain::changes::{CalendarChangeLogPruner, CalendarChangeOp};

#[cfg(test)]
mod test;

/// The changes one transaction made, appended to each link's log as one
/// contiguous block immediately before the transaction commits.
#[derive(Debug, Default)]
pub(super) struct ChangeLogBatch {
    links: BTreeMap<Uuid, Vec<CalendarChangeOp>>,
}

impl ChangeLogBatch {
    pub(super) fn record(&mut self, link_id: Uuid, op: CalendarChangeOp) {
        self.links.entry(link_id).or_default().push(op);
    }

    /// Append the batch and commit. Counter rows are the last locks the
    /// transaction takes, in link order, so writers that touch several links
    /// cannot deadlock on them, and no other lock is requested while one is
    /// held.
    pub(super) async fn commit(self, mut tx: Transaction<'_, Postgres>) -> Result<(), Report> {
        for (link_id, ops) in self.links {
            append(&mut tx, link_id, latest_per_target(ops)).await?;
        }
        tx.commit().await.map_err(report)
    }
}

/// Keep each target's last change, ordered by when that change was recorded.
fn latest_per_target(ops: Vec<CalendarChangeOp>) -> Vec<CalendarChangeOp> {
    let last_index: HashMap<(bool, Uuid), usize> = ops
        .iter()
        .enumerate()
        .map(|(index, op)| (target_key(*op), index))
        .collect();
    ops.into_iter()
        .enumerate()
        .filter(|(index, op)| last_index[&target_key(*op)] == *index)
        .map(|(_, op)| op)
        .collect()
}

fn target_key(op: CalendarChangeOp) -> (bool, Uuid) {
    match op {
        CalendarChangeOp::UpsertEvent(id) | CalendarChangeOp::DeleteEvent(id) => (true, id),
        CalendarChangeOp::UpsertCalendar(id) | CalendarChangeOp::DeleteCalendar(id) => (false, id),
    }
}

pub(super) fn kind_code(op: CalendarChangeOp) -> i16 {
    match op {
        CalendarChangeOp::UpsertEvent(_) => 1,
        CalendarChangeOp::DeleteEvent(_) => 2,
        CalendarChangeOp::UpsertCalendar(_) => 3,
        CalendarChangeOp::DeleteCalendar(_) => 4,
    }
}

pub(super) fn op_from_row(
    kind: i16,
    event_id: Option<Uuid>,
    calendar_id: Option<Uuid>,
) -> Result<CalendarChangeOp, Report> {
    match (kind, event_id, calendar_id) {
        (1, Some(id), None) => Ok(CalendarChangeOp::UpsertEvent(id)),
        (2, Some(id), None) => Ok(CalendarChangeOp::DeleteEvent(id)),
        (3, None, Some(id)) => Ok(CalendarChangeOp::UpsertCalendar(id)),
        (4, None, Some(id)) => Ok(CalendarChangeOp::DeleteCalendar(id)),
        _ => Err(rootcause::report!(
            "calendar change log row has an unknown kind or target"
        )),
    }
}

async fn append(
    tx: &mut Transaction<'_, Postgres>,
    link_id: Uuid,
    ops: Vec<CalendarChangeOp>,
) -> Result<(), Report> {
    let count = i64::try_from(ops.len())
        .map_err(|_| rootcause::report!("calendar change batch is too large"))?;
    if count == 0 {
        return Ok(());
    }
    let last = sqlx::query_scalar!(
        r#"
        INSERT INTO calendar_change_counters (link_id, seq)
        VALUES ($1, $2)
        ON CONFLICT (link_id) DO UPDATE
        SET seq = calendar_change_counters.seq + EXCLUDED.seq,
            updated_at = now()
        RETURNING seq
        "#,
        link_id,
        count,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(report)?;
    let seqs: Vec<i64> = (last - count + 1..=last).collect();
    let kinds: Vec<i16> = ops.iter().map(|op| kind_code(*op)).collect();
    let event_ids: Vec<Option<Uuid>> = ops
        .iter()
        .map(|op| match op {
            CalendarChangeOp::UpsertEvent(id) | CalendarChangeOp::DeleteEvent(id) => Some(*id),
            _ => None,
        })
        .collect();
    let calendar_ids: Vec<Option<Uuid>> = ops
        .iter()
        .map(|op| match op {
            CalendarChangeOp::UpsertCalendar(id) | CalendarChangeOp::DeleteCalendar(id) => {
                Some(*id)
            }
            _ => None,
        })
        .collect();
    sqlx::query!(
        r#"
        INSERT INTO calendar_change_log (link_id, seq, kind, event_id, calendar_id)
        SELECT $1, change.seq, change.kind, change.event_id, change.calendar_id
        FROM unnest($2::bigint[], $3::smallint[], $4::uuid[], $5::uuid[])
            AS change(seq, kind, event_id, calendar_id)
        "#,
        link_id,
        &seqs,
        &kinds,
        &event_ids as &[Option<Uuid>],
        &calendar_ids as &[Option<Uuid>],
    )
    .execute(&mut **tx)
    .await
    .map_err(report)?;
    Ok(())
}

impl CalendarChangeLogPruner for PgCalendarRepository {
    #[tracing::instrument(skip(self), err)]
    async fn prune_change_log(&self, cutoff: DateTime<Utc>, batch: usize) -> Result<usize, Report> {
        let limit = i64::try_from(batch)
            .map_err(|_| rootcause::report!("calendar change prune batch is too large"))?;
        let removed = sqlx::query!(
            r#"
            WITH doomed AS (
                SELECT link_id, seq
                FROM calendar_change_log
                WHERE created_at < $1
                ORDER BY created_at
                LIMIT $2
            )
            DELETE FROM calendar_change_log log
            USING doomed
            WHERE log.link_id = doomed.link_id
              AND log.seq = doomed.seq
            "#,
            cutoff,
            limit,
        )
        .execute(&self.pool)
        .await
        .map_err(report)?
        .rows_affected();
        sqlx::query!(
            r#"
            DELETE FROM calendar_change_counters counter
            WHERE NOT EXISTS (
                SELECT 1 FROM email_links link WHERE link.id = counter.link_id
            )
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(report)?;
        usize::try_from(removed).map_err(|_| rootcause::report!("pruned row count overflows"))
    }
}
