//! Import-owned helpers for the worker composition root's shared transaction.
//! No helper writes comms tables. The caller must roll back the entire transaction
//! on any error, including a failed final fence check, and commit only after finish.

use macro_user_id::cowlike::CowLike;
use sqlx::{Postgres, Transaction};

use super::{
    lifecycle::{fence, number},
    *,
};

#[cfg(test)]
mod test;

/// Trusted persisted context read under the execution fence.
pub struct WriteContext {
    /// Namespace owning the job.
    pub team: TeamId,
    /// Persisted administrator, never supplied by a queue message.
    pub requester: MacroUserIdStr<'static>,
    /// Persisted source kind.
    pub kind: ConversationKind,
    /// Previously authorized target, if bound.
    pub channel: Option<Uuid>,
    /// Current committed restart point.
    pub checkpoint: Checkpoint,
}

/// Fence before any owning-crate writes and load their trusted context.
pub async fn write_context(
    tx: &mut Transaction<'_, Postgres>,
    lease: &Lease,
) -> PortResult<WriteContext> {
    let team = fence(tx, lease).await?;
    let row = sqlx::query!(
        r#"SELECT j.user_id, c.kind, c.channel_id, c.checkpoint_part, c.checkpoint_record
           FROM slack_import_job j JOIN slack_import_conversation c ON c.job_id = j.id
           WHERE j.id = $1 AND c.slack_channel_id = $2"#,
        Uuid::from(lease.event.job_id),
        lease.event.slack_channel_id.as_str(),
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(WriteContext {
        team,
        requester: MacroUserIdStr::parse_from_str(&row.user_id)
            .map_err(internal)?
            .into_owned(),
        kind: parse_enum(&row.kind)?,
        channel: row.channel_id,
        checkpoint: Checkpoint {
            part_index: row.checkpoint_part as u32,
            record_index: row.checkpoint_record as u32,
        },
    })
}

/// Persist warnings idempotently under the same fence as target binding.
pub async fn record_warnings(
    tx: &mut Transaction<'_, Postgres>,
    lease: &Lease,
    warnings: &[ImportWarning],
) -> PortResult<()> {
    let team = fence(tx, lease).await?;
    for warning in warnings {
        let warning = super::lifecycle::enum_string(warning)?;
        sqlx::query!(
            r#"UPDATE slack_import_conversation SET warnings = array_append(warnings, $3)
               WHERE job_id = $1 AND slack_channel_id = $2 AND NOT ($3 = ANY(warnings))"#,
            Uuid::from(lease.event.job_id),
            lease.event.slack_channel_id.as_str(),
            warning,
        )
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    }
    bump_revision(tx, team, lease.event.job_id).await
}

/// A mapping selected by first-commit-wins source identity.
#[derive(Debug)]
pub struct MessageMapping {
    /// Exact source identity.
    pub source: SourceMessageId,
    /// Existing message ID or the newly reserved candidate.
    pub message_id: Uuid,
    /// Only newly reserved candidates may be inserted into comms by the coordinator.
    pub inserted: bool,
}

/// Result of checking a batch's expected and next checkpoints under its lease.
pub enum BatchStart<'a, 'c> {
    /// The entire checkpoint is already committed; do not write messages or reactions.
    Replayed(ImportCounters),
    /// Holds the job lock for all owning-crate operations in the shared transaction.
    Ready(FencedBatch<'a, 'c>),
}

/// Locked import batch. Use `transaction` for other owning-crate helpers, then
/// `finish` before committing. A dropped/error batch must roll back the transaction.
pub struct FencedBatch<'a, 'c> {
    tx: &'a mut Transaction<'c, Postgres>,
    lease: &'a Lease,
    team: TeamId,
    channel: Option<Uuid>,
    next: Checkpoint,
    records: u64,
    mapped: bool,
    imported: u64,
    duplicates: u64,
}

/// Persist the authorized target, including for zero-part shape-only imports.
/// The coordinator calls the channel owner's creation helpers in this transaction;
/// the immediate channel FK requires creation before this call. Existing targets
/// are immutable and authorization remains the caller's domain responsibility.
pub async fn bind_target(
    tx: &mut Transaction<'_, Postgres>,
    lease: &Lease,
    channel: Uuid,
) -> PortResult<()> {
    let team = fence(tx, lease).await?;
    let row = sqlx::query!(
        "SELECT channel_id FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = $2",
        Uuid::from(lease.event.job_id), lease.event.slack_channel_id.as_str(),
    ).fetch_one(&mut **tx).await.map_err(internal)?;
    match row.channel_id {
        Some(existing) if existing != channel => return Err(ImportError::Conflict.into()),
        Some(_) => return Ok(()),
        None => (),
    }
    sqlx::query!(
        "UPDATE slack_import_conversation SET channel_id = $3 WHERE job_id = $1 AND slack_channel_id = $2",
        Uuid::from(lease.event.job_id), lease.event.slack_channel_id.as_str(), channel,
    ).execute(&mut **tx).await.map_err(internal)?;
    bump_revision(tx, team, lease.event.job_id).await
}

/// Check the execution fence and exact expected restart point before ANY writes.
/// A target is supplied only after domain authorization; an existing target cannot
/// be changed. Checkpoint distance includes every skipped record and part boundary.
pub async fn begin_batch<'a, 'c>(
    tx: &'a mut Transaction<'c, Postgres>,
    lease: &'a Lease,
    expected: Checkpoint,
    next: Checkpoint,
    channel: Option<Uuid>,
) -> PortResult<BatchStart<'a, 'c>> {
    let team = fence(tx, lease).await?;
    let row = sqlx::query!(
        r#"SELECT checkpoint_part, checkpoint_record, part_count, channel_id,
           processed, imported, duplicates, skipped, reactions
           FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = $2"#,
        Uuid::from(lease.event.job_id),
        lease.event.slack_channel_id.as_str(),
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)?;
    let current = Checkpoint {
        part_index: row.checkpoint_part as u32,
        record_index: row.checkpoint_record as u32,
    };
    if position(next) <= position(current) {
        return Ok(BatchStart::Replayed(ImportCounters {
            processed: row.processed as u64,
            imported: row.imported as u64,
            duplicates: row.duplicates as u64,
            skipped: row.skipped as u64,
            reactions: row.reactions as u64,
        }));
    }
    if current != expected || row.channel_id.is_some_and(|id| channel != Some(id)) {
        return Err(ImportError::Conflict.into());
    }
    let count = row.part_count.ok_or(ImportError::Conflict)? as u32;
    if next.part_index > count || (next.part_index == count && next.record_index != 0) {
        return Err(ImportError::InvalidInput.into());
    }
    let parts = sqlx::query!(
        r#"SELECT part_index AS "part_index!", record_count AS "record_count!" FROM slack_import_upload
           WHERE job_id = $1 AND slack_channel_id = $2 AND part_index >= $3 AND part_index <= $4
           ORDER BY part_index"#,
        Uuid::from(lease.event.job_id), lease.event.slack_channel_id.as_str(),
        i32::try_from(current.part_index).map_err(internal)?, i32::try_from(next.part_index).map_err(internal)?,
    ).fetch_all(&mut **tx).await.map_err(internal)?;
    let mut records = 0_u64;
    for part in parts {
        let index = part.part_index as u32;
        let end = if index == next.part_index {
            next.record_index
        } else {
            part.record_count as u32
        };
        let start = if index == current.part_index {
            current.record_index
        } else {
            0
        };
        // A consumed part is represented by the next part's record zero, not
        // by a second spelling at the end of the old part.
        if end > part.record_count as u32
            || end < start
            || (index == next.part_index && end == part.record_count as u32)
        {
            return Err(ImportError::InvalidInput.into());
        }
        records += u64::from(end - start);
    }
    if records == 0 {
        return Err(ImportError::InvalidInput.into());
    }
    sqlx::query!(
        "UPDATE slack_import_conversation SET channel_id = $3 WHERE job_id = $1 AND slack_channel_id = $2",
        Uuid::from(lease.event.job_id), lease.event.slack_channel_id.as_str(), channel,
    ).execute(&mut **tx).await.map_err(internal)?;
    Ok(BatchStart::Ready(FencedBatch {
        tx,
        lease,
        team,
        channel,
        next,
        records,
        mapped: false,
        imported: 0,
        duplicates: 0,
    }))
}

impl<'c> FencedBatch<'_, 'c> {
    /// Borrow the SAME transaction for message/reaction owning-crate helpers.
    pub fn transaction(&mut self) -> &mut Transaction<'c, Postgres> {
        self.tx
    }

    /// Reserve source mappings in timestamp order before writing messages. Deferred
    /// FKs ensure a failed/missing comms insert rolls back the mappings as well.
    /// The composition root enforces its configured message/byte ceilings too.
    pub async fn reserve_mappings(
        &mut self,
        messages: &[HistoricalMessage],
    ) -> PortResult<Vec<MessageMapping>> {
        if self.mapped || messages.len() > ImportLimits::default().database_batch_messages as usize
        {
            return Err(ImportError::LimitExceeded.into());
        }
        let mut identities = HashSet::new();
        let mut ids = HashSet::new();
        for message in messages {
            if message.source.team_id != self.team
                || message.source.slack_channel_id != self.lease.event.slack_channel_id
                || Some(message.channel_id) != self.channel
                || !identities.insert(message.source.ts)
                || !ids.insert(message.id)
            {
                return Err(ImportError::InvalidInput.into());
            }
        }
        let payload = serde_json::Value::Array(
            messages
                .iter()
                .map(|m| {
                    serde_json::json!({
                        "ts": m.source.ts.unix_micros(), "message_id": m.id,
                    })
                })
                .collect(),
        );
        let inserted = sqlx::query!(
            r#"INSERT INTO slack_import_message_map (team_id, slack_channel_id, slack_ts, message_id, channel_id)
               SELECT $1, $2, m.ts, m.message_id, $3 FROM jsonb_to_recordset($4) AS m(ts bigint, message_id uuid)
               ORDER BY m.ts ON CONFLICT (team_id, slack_channel_id, slack_ts) DO NOTHING RETURNING slack_ts"#,
            Uuid::from(self.team), self.lease.event.slack_channel_id.as_str(), self.channel, payload,
        ).fetch_all(&mut **self.tx).await.map_err(internal)?;
        let inserted: HashSet<i64> = inserted.into_iter().map(|r| r.slack_ts).collect();
        // A separate READ COMMITTED statement observes a conflicting mapping after
        // waiting for the other job's insert to commit; an INSERT CTE cannot do that.
        let timestamps: Vec<i64> = messages.iter().map(|m| m.source.ts.unix_micros()).collect();
        let rows = sqlx::query!(
            r#"SELECT slack_ts, message_id, channel_id FROM slack_import_message_map
               WHERE team_id = $1 AND slack_channel_id = $2 AND slack_ts = ANY($3)"#,
            Uuid::from(self.team),
            self.lease.event.slack_channel_id.as_str(),
            &timestamps,
        )
        .fetch_all(&mut **self.tx)
        .await
        .map_err(internal)?;
        if rows.iter().any(|r| Some(r.channel_id) != self.channel) {
            return Err(ImportError::Conflict.into());
        }
        let mappings: HashMap<i64, Uuid> = rows
            .into_iter()
            .map(|r| (r.slack_ts, r.message_id))
            .collect();
        let result = messages
            .iter()
            .map(|m| {
                Ok(MessageMapping {
                    source: m.source.clone(),
                    message_id: *mappings
                        .get(&m.source.ts.unix_micros())
                        .ok_or(ImportError::Internal)?,
                    inserted: inserted.contains(&m.source.ts.unix_micros()),
                })
            })
            .collect::<PortResult<Vec<_>>>()?;
        self.mapped = true;
        self.imported = inserted.len() as u64;
        self.duplicates = messages.len() as u64 - self.imported;
        Ok(result)
    }

    /// Commit checkpoint/counters and search outbox state alongside the caller's
    /// rows. `reactions` counts actual new reaction inserts, never attempted writes.
    /// Skipped-only batches are durable too. Recheck time after potentially slow SQL.
    pub async fn finish(self, skipped: u64, reactions: u64) -> PortResult<ImportCounters> {
        if self
            .imported
            .checked_add(self.duplicates)
            .and_then(|n| n.checked_add(skipped))
            != Some(self.records)
        {
            return Err(ImportError::InvalidInput.into());
        }
        fence(self.tx, self.lease).await?;
        let dirty = self.imported > 0 || reactions > 0;
        if dirty && self.channel.is_none() {
            return Err(ImportError::InvalidInput.into());
        }
        let row = sqlx::query!(
            r#"UPDATE slack_import_conversation SET checkpoint_part = $3, checkpoint_record = $4,
               processed = processed + $5, imported = imported + $6, duplicates = duplicates + $7,
               skipped = skipped + $8, reactions = reactions + $9,
               search_dirty_generation = search_dirty_generation + CASE WHEN $10 THEN 1 ELSE 0 END,
               search_state = CASE WHEN $10 THEN 'pending' ELSE search_state END,
               search_receipt_id = CASE WHEN $10 THEN NULL ELSE search_receipt_id END,
               search_submitted_generation = CASE WHEN $10 THEN NULL ELSE search_submitted_generation END,
               search_updated_at = CASE WHEN $10 THEN clock_timestamp() ELSE search_updated_at END,
               updated_at = clock_timestamp()
               WHERE job_id = $1 AND slack_channel_id = $2
               RETURNING processed, imported, duplicates, skipped, reactions, search_dirty_generation"#,
            Uuid::from(self.lease.event.job_id), self.lease.event.slack_channel_id.as_str(),
            i32::try_from(self.next.part_index).map_err(internal)?, i32::try_from(self.next.record_index).map_err(internal)?,
            number(self.records)?, number(self.imported)?, number(self.duplicates)?, number(skipped)?, number(reactions)?, dirty,
        ).fetch_one(&mut **self.tx).await.map_err(internal)?;
        if dirty {
            sqlx::query!(
                r#"UPDATE slack_import_outbox SET cancelled_at = clock_timestamp()
                   WHERE job_id = $1 AND slack_channel_id = $2 AND kind = 'search'
                     AND published_at IS NULL AND cancelled_at IS NULL"#,
                Uuid::from(self.lease.event.job_id),
                self.lease.event.slack_channel_id.as_str(),
            )
            .execute(&mut **self.tx)
            .await
            .map_err(internal)?;
            sqlx::query!(
                r#"INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation)
                   VALUES ($1, $2, 'search', $3) ON CONFLICT (job_id, slack_channel_id, kind, generation) DO NOTHING"#,
                Uuid::from(self.lease.event.job_id), self.lease.event.slack_channel_id.as_str(), row.search_dirty_generation,
            ).execute(&mut **self.tx).await.map_err(internal)?;
        }
        bump_revision(self.tx, self.team, self.lease.event.job_id).await?;
        Ok(ImportCounters {
            processed: row.processed as u64,
            imported: row.imported as u64,
            duplicates: row.duplicates as u64,
            skipped: row.skipped as u64,
            reactions: row.reactions as u64,
        })
    }
}

/// Resolve a bounded set of exact source mappings for thread parents. No ownership
/// is inferred from these IDs: the message owner validates target/parent membership.
pub async fn lookup(
    connection: &mut PgConnection,
    sources: &[SourceMessageId],
) -> PortResult<Vec<(SourceMessageId, Uuid)>> {
    if sources.len() > ImportLimits::default().database_batch_messages as usize {
        return Err(ImportError::LimitExceeded.into());
    }
    let payload = serde_json::Value::Array(sources.iter().enumerate().map(|(index, s)| serde_json::json!({
        "index": index, "team": Uuid::from(s.team_id), "channel": s.slack_channel_id, "ts": s.ts.unix_micros(),
    })).collect());
    let rows = sqlx::query!(
        r#"SELECT s.index AS "index!", m.message_id FROM jsonb_to_recordset($1) AS s(index integer, team uuid, channel text, ts bigint)
           JOIN slack_import_message_map m ON m.team_id = s.team AND m.slack_channel_id = s.channel AND m.slack_ts = s.ts"#,
        payload,
    ).fetch_all(connection).await.map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|r| (sources[r.index as usize].clone(), r.message_id))
        .collect())
}

impl crate::domain::ports::SourceMessageReader for PgSlackImportRepo {
    async fn reference_mappings(
        &self,
        team: TeamId,
        sources: &[SourceMessageId],
    ) -> PortResult<Vec<crate::domain::slack::references::resolve::StoredMessageMapping>> {
        use crate::domain::slack::references::resolve::StoredMessageMapping;
        if sources.len()
            > self
                .limits
                .database_batch_messages
                .min(ImportLimits::default().database_batch_messages) as usize
            || sources.iter().any(|source| source.team_id != team)
        {
            return Err(ImportError::LimitExceeded.into());
        }
        let payload = serde_json::Value::Array(
            sources
                .iter()
                .enumerate()
                .map(|(index, s)| {
                    serde_json::json!({
                        "index": index, "channel": s.slack_channel_id, "ts": s.ts.unix_micros(),
                    })
                })
                .collect(),
        );
        if serde_json::to_vec(&payload).map_err(internal)?.len() as u64
            > self.limits.database_batch_bytes
        {
            return Err(ImportError::LimitExceeded.into());
        }
        let rows = sqlx::query!(
            r#"SELECT s.index AS "index!", m.message_id, m.channel_id
               FROM jsonb_to_recordset($1) AS s(index integer, channel text, ts bigint)
               JOIN slack_import_message_map m ON m.team_id = $2
                 AND m.slack_channel_id = s.channel AND m.slack_ts = s.ts"#,
            payload,
            Uuid::from(team),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        Ok(rows
            .into_iter()
            .map(|row| StoredMessageMapping {
                source: sources[row.index as usize].clone(),
                channel: row.channel_id,
                message: row.message_id,
            })
            .collect())
    }
}

impl PgSlackImportRepo {
    /// Load source scope and requester only from an explicitly team-owned job.
    /// Binding and domain evidence are supplied by the owning ledger, not SQL here.
    pub async fn reference_job(
        &self,
        team: TeamId,
        job: JobId,
    ) -> PortResult<Option<(MacroUserIdStr<'static>, SourceIdentity)>> {
        let row = sqlx::query!(
            "SELECT user_id, source_workspace_id, confirmed_unknown FROM slack_import_job WHERE team_id = $1 AND id = $2",
            Uuid::from(team), Uuid::from(job),
        ).fetch_optional(&self.pool).await.map_err(internal)?;
        row.map(|row| {
            let source = match row.source_workspace_id {
                Some(source) => SourceIdentity::Known {
                    source_id: source.parse().map_err(internal)?,
                },
                None if row.confirmed_unknown => SourceIdentity::ConfirmedUnknown,
                None => return Err(ImportError::Unavailable.into()),
            };
            Ok((
                MacroUserIdStr::parse_from_str(&row.user_id)
                    .map_err(internal)?
                    .into_owned(),
                source,
            ))
        })
        .transpose()
    }

    /// Bounded selected work with remaining resolution opportunity; no target IDs.
    pub async fn pending_reference_channels(
        &self,
        team: TeamId,
        job: JobId,
        channels: &[ConversationId],
    ) -> PortResult<Vec<ConversationId>> {
        if channels.len()
            > self
                .limits
                .database_batch_messages
                .min(ImportLimits::default().database_batch_messages) as usize
        {
            return Err(ImportError::LimitExceeded.into());
        }
        let ids: Vec<_> = channels.iter().map(ConversationId::as_str).collect();
        let rows = sqlx::query_scalar!(
            r#"SELECT c.slack_channel_id FROM slack_import_conversation c
               JOIN slack_import_job j ON j.id = c.job_id
               WHERE j.team_id = $1 AND j.id = $2 AND c.slack_channel_id = ANY($3)
                 AND c.status IN ('awaiting_uploads', 'queued', 'importing')"#,
            Uuid::from(team),
            Uuid::from(job),
            &ids as _,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        rows.into_iter()
            .map(|id| id.parse().map_err(internal))
            .collect()
    }
}

fn position(checkpoint: Checkpoint) -> (u32, u32) {
    (checkpoint.part_index, checkpoint.record_index)
}

pub(super) async fn pending_search(pool: &PgPool, limit: u32) -> PortResult<Vec<SearchBackfill>> {
    let rows = sqlx::query!(
        r#"SELECT c.job_id, c.channel_id AS "channel_id!", c.search_dirty_generation, c.search_state,
           c.search_receipt_id, c.search_updated_at FROM slack_import_conversation c
           JOIN slack_import_outbox o ON o.job_id = c.job_id AND o.slack_channel_id = c.slack_channel_id
             AND o.kind = 'search' AND o.generation = c.search_dirty_generation
           WHERE c.channel_id IS NOT NULL AND c.search_state IN ('pending', 'submitted', 'failed')
             AND o.cancelled_at IS NULL AND o.available_at <= clock_timestamp()
             AND NOT EXISTS (SELECT 1 FROM slack_import_message_reference r
                 WHERE r.job_id = c.job_id AND r.completed_at IS NULL)
           ORDER BY c.search_updated_at, c.job_id, c.slack_channel_id LIMIT $1"#, i64::from(limit),
    ).fetch_all(pool).await.map_err(internal)?;
    rows.into_iter()
        .map(|r| {
            Ok(SearchBackfill {
                job_id: r.job_id.try_into().map_err(internal)?,
                channel_ids: vec![r.channel_id],
                generation: r.search_dirty_generation as u64,
                state: match r.search_state.as_str() {
                    "submitted" => SearchState::Submitted {
                        receipt_id: r.search_receipt_id.ok_or(ImportError::Internal)?,
                    },
                    "failed" => SearchState::Failed,
                    _ => SearchState::Pending,
                },
                updated_at: r.search_updated_at,
            })
        })
        .collect()
}

pub(super) async fn record_search(
    pool: &PgPool,
    request: &SearchBackfill,
    state: SearchState,
) -> PortResult<()> {
    if request.channel_ids.is_empty()
        || request.channel_ids.len() > 50
        || matches!(state, SearchState::NotNeeded)
    {
        return Err(ImportError::InvalidInput.into());
    }
    let mut tx = pool.begin().await.map_err(internal)?;
    let team = sqlx::query_scalar!(
        "SELECT team_id FROM slack_import_job WHERE id = $1 FOR UPDATE",
        Uuid::from(request.job_id)
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let Some(team) = team else {
        return Ok(());
    };
    let (status, receipt) = match state {
        SearchState::Submitted { receipt_id } => ("submitted", Some(receipt_id)),
        SearchState::Pending => ("pending", None),
        SearchState::Completed => ("completed", None),
        SearchState::Failed => ("failed", None),
        SearchState::NotNeeded => return Err(ImportError::InvalidInput.into()),
    };
    let previous_receipt = match request.state {
        SearchState::Submitted { receipt_id } => Some(receipt_id),
        _ => None,
    };
    let rows = sqlx::query!(
        r#"UPDATE slack_import_conversation SET search_state = $4, search_receipt_id = $5,
           search_submitted_generation = CASE WHEN $5::uuid IS NOT NULL THEN $3 ELSE search_submitted_generation END,
           search_attempts = search_attempts + CASE WHEN $4 = 'submitted' THEN 1 ELSE 0 END,
           search_updated_at = clock_timestamp(), updated_at = clock_timestamp()
           WHERE job_id = $1 AND channel_id = ANY($2) AND search_dirty_generation = $3
             AND search_state <> 'completed' AND search_receipt_id IS NOT DISTINCT FROM $6
             AND search_updated_at = $7
           RETURNING slack_channel_id"#,
        Uuid::from(request.job_id), &request.channel_ids, number(request.generation)?, status, receipt,
        previous_receipt, request.updated_at,
    ).fetch_all(&mut *tx).await.map_err(internal)?;
    if !rows.is_empty() {
        let channels: Vec<String> = rows.into_iter().map(|r| r.slack_channel_id).collect();
        sqlx::query!(
            r#"UPDATE slack_import_outbox SET
               published_at = CASE WHEN $4 = 'completed' THEN coalesce(published_at, clock_timestamp()) ELSE published_at END,
               available_at = clock_timestamp() + interval '60 seconds'
               WHERE job_id = $1 AND slack_channel_id = ANY($2) AND kind = 'search' AND generation = $3"#,
            Uuid::from(request.job_id), &channels, number(request.generation)?, status,
        ).execute(&mut *tx).await.map_err(internal)?;
        bump_revision(&mut tx, team.try_into().map_err(internal)?, request.job_id).await?;
        super::lifecycle::recompute(&mut tx, request.job_id).await?;
    }
    tx.commit().await.map_err(internal)?;
    Ok(())
}
