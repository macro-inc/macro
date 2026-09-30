//! Job-first locking, execution fencing and durable queue recovery.

use macro_user_id::cowlike::CowLike;

use crate::domain::ports::{ExecutionRepo, ImportRepo};

use super::*;

#[cfg(test)]
pub(super) mod test;

const LEASE_SECONDS: f64 = 180.0;
const MAX_ATTEMPTS: i32 = 5;
const PAGE_LIMIT: u32 = 50;

impl ImportRepo for PgSlackImportRepo {
    async fn create(
        &self,
        team: TeamId,
        admin: &MacroUserIdStr<'_>,
        command: &CreateImport,
        limits: &ImportLimits,
    ) -> PortResult<ImportProgress> {
        Self::create(self, team, admin, command, limits).await
    }
    async fn register(
        &self,
        team: TeamId,
        job: JobId,
        command: &RegisterUploads,
    ) -> PortResult<Vec<RegisteredUpload>> {
        Self::register(self, team, job, command).await
    }
    async fn uploads(
        &self,
        team: TeamId,
        job: JobId,
        uploads: &[UploadId],
    ) -> PortResult<Vec<RegisteredUpload>> {
        Self::uploads(self, team, job, uploads).await
    }
    async fn complete(
        &self,
        team: TeamId,
        job: JobId,
        verified: &[VerifiedUpload],
        seal: Option<&ConversationSeal>,
    ) -> PortResult<ImportProgress> {
        Self::complete(self, team, job, verified, seal).await
    }
    async fn finalize(&self, team: TeamId, job: JobId) -> PortResult<ImportProgress> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        lock_job(&mut tx, team, job).await?;
        let changed = sqlx::query!(
            r#"UPDATE slack_import_job SET registration_closed_at = clock_timestamp(),
               finalized_at = clock_timestamp() WHERE team_id = $1 AND id = $2
               AND registration_closed_at IS NULL"#,
            Uuid::from(team),
            Uuid::from(job),
        )
        .execute(&mut *tx)
        .await
        .map_err(internal)?
        .rows_affected()
            > 0;
        if changed {
            sqlx::query!(
                r#"UPDATE slack_import_conversation SET status = 'skipped',
                   warnings = array_append(warnings, 'uploads_incomplete'),
                   settled_at = clock_timestamp(), updated_at = clock_timestamp()
                   WHERE job_id = $1 AND status = 'awaiting_uploads'"#,
                Uuid::from(job),
            )
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
            recompute(&mut tx, job).await?;
        }
        let result = self.receipt(&mut tx, team, job).await?;
        tx.commit().await.map_err(internal)?;
        Ok(result)
    }
    async fn cancel(&self, team: TeamId, job: JobId) -> PortResult<ImportProgress> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        lock_job(&mut tx, team, job).await?;
        let changed = sqlx::query!(
            r#"UPDATE slack_import_job SET
               registration_closed_at = coalesce(registration_closed_at, clock_timestamp()),
               cancel_requested_at = clock_timestamp(), status = 'cancelling'
               WHERE team_id = $1 AND id = $2 AND status IN ('uploading', 'processing')"#,
            Uuid::from(team),
            Uuid::from(job),
        )
        .execute(&mut *tx)
        .await
        .map_err(internal)?
        .rows_affected()
            > 0;
        if changed {
            sqlx::query!(
                r#"UPDATE slack_import_conversation SET status = 'skipped',
                   settled_at = clock_timestamp(), updated_at = clock_timestamp()
                   WHERE job_id = $1 AND status IN ('awaiting_uploads', 'queued')"#,
                Uuid::from(job),
            )
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
            sqlx::query!(
                r#"UPDATE slack_import_outbox SET cancelled_at = clock_timestamp()
                   WHERE job_id = $1 AND kind = 'import' AND published_at IS NULL AND cancelled_at IS NULL"#,
                Uuid::from(job),
            ).execute(&mut *tx).await.map_err(internal)?;
            recompute(&mut tx, job).await?;
        }
        let result = self.receipt(&mut tx, team, job).await?;
        tx.commit().await.map_err(internal)?;
        Ok(result)
    }
    async fn progress(&self, team: TeamId, job: JobId) -> PortResult<Option<ImportProgress>> {
        Self::progress(self, team, job).await
    }
    async fn list(&self, team: TeamId, before: Option<JobId>) -> PortResult<Vec<ImportProgress>> {
        Self::list(self, team, before).await
    }
}

impl ExecutionRepo for PgSlackImportRepo {
    async fn requester(
        &self,
        event: &ImportEvent,
    ) -> PortResult<Option<(TeamId, MacroUserIdStr<'static>)>> {
        let generation = number(event.generation)?;
        let row = sqlx::query!(
            r#"SELECT j.team_id, j.user_id FROM slack_import_job j
               JOIN slack_import_conversation c ON c.job_id = j.id
               WHERE j.id = $1 AND c.slack_channel_id = $2 AND c.event_generation = $3
                 AND c.status IN ('queued', 'importing') AND j.cancel_requested_at IS NULL"#,
            Uuid::from(event.job_id),
            event.slack_channel_id.as_str(),
            generation,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(internal)?;
        row.map(|r| {
            Ok((
                r.team_id.try_into().map_err(internal)?,
                MacroUserIdStr::parse_from_str(&r.user_id)
                    .map_err(internal)?
                    .into_owned(),
            ))
        })
        .transpose()
    }

    async fn claim(&self, event: &ImportEvent, owner: WorkerId) -> PortResult<ClaimOutcome> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let Some(job) = lock_execution_job(&mut tx, event.job_id).await? else {
            return Ok(ClaimOutcome::Obsolete);
        };
        if job.cancelled || job.expired || job.terminal {
            return Ok(ClaimOutcome::Obsolete);
        }
        let generation = number(event.generation)?;
        let row = sqlx::query!(
            r#"SELECT status, attempts, lease_expires_at > clock_timestamp() AS active
               FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = $2 AND event_generation = $3"#,
            Uuid::from(event.job_id), event.slack_channel_id.as_str(), generation,
        ).fetch_optional(&mut *tx).await.map_err(internal)?;
        let Some(row) = row else {
            return Ok(ClaimOutcome::Obsolete);
        };
        if row.status == "importing" && row.active == Some(true) {
            return Ok(ClaimOutcome::ActiveLease);
        }
        if !matches!(row.status.as_str(), "queued" | "importing") {
            return Ok(ClaimOutcome::Obsolete);
        }
        if row.attempts >= MAX_ATTEMPTS {
            terminal(&mut tx, event, "failed", Some(ImportError::Internal)).await?;
            tx.commit().await.map_err(internal)?;
            return Ok(ClaimOutcome::Obsolete);
        }
        let token = Uuid::now_v7();
        let row = sqlx::query!(
            r#"UPDATE slack_import_conversation SET status = 'importing', lease_owner = $3,
               lease_token = $4, lease_generation = lease_generation + 1, attempts = attempts + 1,
               lease_expires_at = clock_timestamp() + make_interval(secs => $5),
               heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
               WHERE job_id = $1 AND slack_channel_id = $2
               RETURNING lease_generation, attempts, lease_expires_at, heartbeat_at,
               kind, name, folder, member_ids, creator_id, source_created_at, archived, message_count,
               checkpoint_part, checkpoint_record"#,
            Uuid::from(event.job_id), event.slack_channel_id.as_str(), Uuid::from(owner), token, LEASE_SECONDS,
        ).fetch_one(&mut *tx).await.map_err(internal)?;
        let uploads = verified_uploads(&mut tx, event).await?;
        let mut users = None;
        let mut parts = Vec::new();
        for upload in uploads {
            match upload.registered.descriptor.upload {
                UploadId::Users => users = Some(upload),
                UploadId::ConversationPart { .. } => parts.push(upload),
            }
        }
        bump_revision(
            &mut tx,
            job.team_id.try_into().map_err(internal)?,
            event.job_id,
        )
        .await?;
        let claimed = ClaimedConversation {
            lease: Lease {
                event: event.clone(),
                owner,
                token: token.try_into().map_err(internal)?,
                generation: row.lease_generation as u64,
                expires_at: row.lease_expires_at.ok_or(ImportError::Internal)?,
                heartbeat_at: row.heartbeat_at.ok_or(ImportError::Internal)?,
                attempts: row.attempts as u32,
            },
            team_id: job.team_id.try_into().map_err(internal)?,
            requested_by: MacroUserIdStr::parse_from_str(&job.user_id)
                .map_err(internal)?
                .into_owned(),
            metadata: ConversationMetadata {
                slack_channel_id: event.slack_channel_id.clone(),
                kind: parse_enum(&row.kind)?,
                name: row.name,
                folder: row.folder.parse().map_err(internal)?,
                member_ids: row
                    .member_ids
                    .iter()
                    .map(|s| s.parse().map_err(internal))
                    .collect::<PortResult<_>>()?,
                creator_id: row
                    .creator_id
                    .map(|s| s.parse().map_err(internal))
                    .transpose()?,
                created_at: row.source_created_at.map(timestamp).transpose()?,
                archived: row.archived,
                message_count: row.message_count.map(|n| n as u64),
            },
            users: users.ok_or(ImportError::Internal)?,
            parts,
            checkpoint: Checkpoint {
                part_index: row.checkpoint_part as u32,
                record_index: row.checkpoint_record as u32,
            },
            job_created_at: job.created_at,
        };
        tx.commit().await.map_err(internal)?;
        Ok(ClaimOutcome::Claimed(Box::new(claimed)))
    }

    async fn heartbeat(&self, lease: &Lease) -> PortResult<Lease> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        fence(&mut tx, lease).await?;
        let row = sqlx::query!(
            r#"UPDATE slack_import_conversation SET heartbeat_at = clock_timestamp(),
               lease_expires_at = clock_timestamp() + make_interval(secs => $3)
               WHERE job_id = $1 AND slack_channel_id = $2 RETURNING heartbeat_at, lease_expires_at"#,
            Uuid::from(lease.event.job_id), lease.event.slack_channel_id.as_str(), LEASE_SECONDS,
        ).fetch_one(&mut *tx).await.map_err(internal)?;
        let mut renewed = lease.clone();
        renewed.heartbeat_at = row.heartbeat_at.ok_or(ImportError::Internal)?;
        renewed.expires_at = row.lease_expires_at.ok_or(ImportError::Internal)?;
        tx.commit().await.map_err(internal)?;
        Ok(renewed)
    }

    async fn settle(
        &self,
        lease: &Lease,
        status: ConversationStatus,
        error: Option<ImportError>,
    ) -> PortResult<()> {
        let status = match status {
            ConversationStatus::Completed => "completed",
            ConversationStatus::Skipped => "skipped",
            ConversationStatus::Failed => "failed",
            _ => return Err(ImportError::InvalidInput.into()),
        };
        let mut tx = self.pool.begin().await.map_err(internal)?;
        fence(&mut tx, lease).await?;
        if status == "completed" {
            let complete = sqlx::query_scalar!(
                r#"SELECT checkpoint_part = part_count AND checkpoint_record = 0 AS "complete!"
                   FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = $2"#,
                Uuid::from(lease.event.job_id),
                lease.event.slack_channel_id.as_str(),
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
            if !complete {
                return Err(ImportError::Conflict.into());
            }
        }
        terminal(&mut tx, &lease.event, status, error).await?;
        tx.commit().await.map_err(internal)?;
        Ok(())
    }

    async fn pending_events(&self, limit: u32) -> PortResult<Vec<ImportEvent>> {
        // Candidate selection never locks a child before its job. A short durable
        // publication reservation recovers automatically after a publisher crash.
        let candidates = sqlx::query!(
            r#"SELECT o.job_id, o.slack_channel_id, o.generation FROM slack_import_outbox o
               JOIN slack_import_job j ON j.id = o.job_id
               JOIN slack_import_conversation c ON c.job_id = o.job_id AND c.slack_channel_id = o.slack_channel_id
               WHERE o.kind = 'import' AND o.published_at IS NULL AND o.cancelled_at IS NULL
                 AND o.available_at <= clock_timestamp() AND j.cancel_requested_at IS NULL
                 AND j.staging_expires_at > clock_timestamp() + interval '1 day'
                 AND c.status IN ('queued', 'importing') AND c.event_generation = o.generation
               ORDER BY o.available_at, o.job_id, o.slack_channel_id LIMIT $1"#, i64::from(limit.min(PAGE_LIMIT)),
        ).fetch_all(&self.pool).await.map_err(internal)?;
        let mut events = Vec::new();
        for row in candidates {
            let mut tx = self.pool.begin().await.map_err(internal)?;
            let job = row.job_id.try_into().map_err(internal)?;
            let Some(state) = lock_execution_job(&mut tx, job).await? else {
                continue;
            };
            if state.cancelled || state.expired || state.terminal {
                continue;
            }
            let changed = sqlx::query!(
                r#"UPDATE slack_import_outbox o SET attempts = o.attempts + 1,
                   available_at = clock_timestamp() + interval '60 seconds'
                   FROM slack_import_conversation c
                   WHERE o.job_id = $1 AND o.slack_channel_id = $2 AND o.kind = 'import' AND o.generation = $3
                     AND o.published_at IS NULL AND o.cancelled_at IS NULL AND o.available_at <= clock_timestamp()
                     AND c.job_id = o.job_id AND c.slack_channel_id = o.slack_channel_id
                     AND c.event_generation = o.generation AND c.status IN ('queued', 'importing')"#,
                row.job_id, row.slack_channel_id, row.generation,
            ).execute(&mut *tx).await.map_err(internal)?.rows_affected() > 0;
            tx.commit().await.map_err(internal)?;
            if changed {
                events.push(ImportEvent {
                    job_id: job,
                    slack_channel_id: row.slack_channel_id.parse().map_err(internal)?,
                    generation: row.generation as u64,
                });
            }
        }
        Ok(events)
    }

    async fn mark_published(&self, event: &ImportEvent) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let Some(_) = lock_execution_job(&mut tx, event.job_id).await? else {
            return Ok(());
        };
        sqlx::query!(
            r#"UPDATE slack_import_outbox SET published_at = clock_timestamp()
               WHERE job_id = $1 AND slack_channel_id = $2 AND kind = 'import' AND generation = $3
                 AND published_at IS NULL AND cancelled_at IS NULL"#,
            Uuid::from(event.job_id),
            event.slack_channel_id.as_str(),
            number(event.generation)?,
        )
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
        tx.commit().await.map_err(internal)?;
        Ok(())
    }

    async fn dead_letter(&self, event: &ImportEvent) -> PortResult<WorkerOutcome> {
        let mut tx = self.pool.begin().await.map_err(internal)?;
        let Some(job) = lock_execution_job(&mut tx, event.job_id).await? else {
            return Ok(WorkerOutcome::Acknowledge);
        };
        let row = sqlx::query!(
            r#"SELECT status, lease_expires_at > clock_timestamp() AS active FROM slack_import_conversation
               WHERE job_id = $1 AND slack_channel_id = $2 AND event_generation = $3"#,
            Uuid::from(event.job_id), event.slack_channel_id.as_str(), number(event.generation)?,
        ).fetch_optional(&mut *tx).await.map_err(internal)?;
        if let Some(row) = row {
            if row.status == "importing" && row.active == Some(true) {
                return Ok(WorkerOutcome::Defer);
            }
            if matches!(row.status.as_str(), "queued" | "importing") {
                let status = if job.cancelled { "skipped" } else { "failed" };
                terminal(&mut tx, event, status, Some(ImportError::Internal)).await?;
            }
        }
        tx.commit().await.map_err(internal)?;
        Ok(WorkerOutcome::Acknowledge)
    }

    async fn reconcile(&self, limit: u32) -> PortResult<()> {
        let jobs = sqlx::query_scalar!(
            r#"SELECT j.id FROM slack_import_job j WHERE j.status IN ('uploading', 'processing', 'cancelling')
               AND (j.staging_expires_at <= clock_timestamp() + interval '1 day'
                 OR EXISTS (SELECT 1 FROM slack_import_conversation c WHERE c.job_id = j.id
                            AND c.status = 'importing' AND c.lease_expires_at <= clock_timestamp()))
               ORDER BY j.staging_expires_at, j.id LIMIT $1"#, i64::from(limit.min(PAGE_LIMIT)),
        ).fetch_all(&self.pool).await.map_err(internal)?;
        for id in jobs {
            let job = id.try_into().map_err(internal)?;
            let mut tx = self.pool.begin().await.map_err(internal)?;
            let Some(state) = lock_execution_job(&mut tx, job).await? else {
                continue;
            };
            if state.terminal {
                continue;
            }
            if state.expired {
                sqlx::query!(
                    r#"UPDATE slack_import_job SET registration_closed_at = coalesce(registration_closed_at, clock_timestamp()),
                       finalized_at = coalesce(finalized_at, clock_timestamp()) WHERE id = $1"#, id,
                ).execute(&mut *tx).await.map_err(internal)?;
                sqlx::query!(
                    r#"UPDATE slack_import_conversation SET status = 'skipped', warnings = array_append(warnings, 'uploads_incomplete'),
                       settled_at = clock_timestamp(), updated_at = clock_timestamp()
                       WHERE job_id = $1 AND status = 'awaiting_uploads'"#, id,
                ).execute(&mut *tx).await.map_err(internal)?;
            }
            // Clear all expired leases, even after cancellation, but never revoke
            // an unexpired worker. New event generations fence late queue/DLQ deliveries.
            sqlx::query!(
                r#"WITH recovered AS (
                   UPDATE slack_import_conversation SET
                     status = CASE WHEN $2 THEN 'skipped' WHEN $3 OR attempts >= $4 THEN 'failed' ELSE 'queued' END,
                     last_error = CASE WHEN $3 OR attempts >= $4 THEN 'internal' ELSE last_error END,
                     settled_at = CASE WHEN $2 OR $3 OR attempts >= $4 THEN clock_timestamp() ELSE NULL END,
                     event_generation = event_generation + 1,
                     lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                     updated_at = clock_timestamp()
                   WHERE job_id = $1 AND ((status = 'importing' AND lease_expires_at <= clock_timestamp())
                     OR (status = 'queued' AND ($2 OR $3)))
                   RETURNING job_id, slack_channel_id, event_generation, status
                ) INSERT INTO slack_import_outbox (job_id, slack_channel_id, kind, generation)
                  SELECT job_id, slack_channel_id, 'import', event_generation FROM recovered WHERE status = 'queued'
                  ON CONFLICT (job_id, slack_channel_id, kind, generation) DO NOTHING"#,
                id, state.cancelled, state.expired, MAX_ATTEMPTS,
            ).execute(&mut *tx).await.map_err(internal)?;
            sqlx::query!(
                r#"UPDATE slack_import_outbox o SET cancelled_at = clock_timestamp()
                   FROM slack_import_conversation c WHERE o.job_id = $1 AND c.job_id = o.job_id
                     AND c.slack_channel_id = o.slack_channel_id AND o.kind = 'import'
                     AND o.published_at IS NULL AND o.cancelled_at IS NULL
                     AND (o.generation <> c.event_generation OR c.status NOT IN ('queued', 'importing'))"#, id,
            ).execute(&mut *tx).await.map_err(internal)?;
            recompute(&mut tx, job).await?;
            tx.commit().await.map_err(internal)?;
        }
        Ok(())
    }

    async fn pending_search(&self, limit: u32) -> PortResult<Vec<SearchBackfill>> {
        batches::pending_search(&self.pool, limit.min(PAGE_LIMIT)).await
    }
    async fn record_search(&self, request: &SearchBackfill, state: SearchState) -> PortResult<()> {
        batches::record_search(&self.pool, request, state).await
    }
}

struct ExecutionJob {
    team_id: Uuid,
    user_id: String,
    created_at: DateTime<Utc>,
    cancelled: bool,
    expired: bool,
    terminal: bool,
}

async fn lock_execution_job(
    connection: &mut PgConnection,
    job: JobId,
) -> PortResult<Option<ExecutionJob>> {
    sqlx::query_as!(
        ExecutionJob,
        r#"SELECT team_id, user_id, created_at, (cancel_requested_at IS NOT NULL) AS "cancelled!",
           (staging_expires_at <= clock_timestamp() + interval '1 day') AS "expired!",
           (status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')) AS "terminal!"
           FROM slack_import_job WHERE id = $1 FOR UPDATE"#,
        Uuid::from(job),
    )
    .fetch_optional(connection)
    .await
    .map_err(internal)
}

/// Lock the job and check every durable fence field, using database time.
/// Cancellation intentionally does not invalidate a still-running lease.
pub(super) async fn fence(connection: &mut PgConnection, lease: &Lease) -> PortResult<TeamId> {
    let job = lock_execution_job(connection, lease.event.job_id)
        .await?
        .ok_or(ImportError::LeaseLost)?;
    if job.terminal || job.expired {
        return Err(ImportError::LeaseLost.into());
    }
    let valid = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = $2
           AND status = 'importing' AND event_generation = $3 AND lease_owner = $4 AND lease_token = $5
           AND lease_generation = $6 AND lease_expires_at > clock_timestamp()) AS "valid!""#,
        Uuid::from(lease.event.job_id), lease.event.slack_channel_id.as_str(), number(lease.event.generation)?,
        Uuid::from(lease.owner), Uuid::from(lease.token), number(lease.generation)?,
    ).fetch_one(connection).await.map_err(internal)?;
    if !valid {
        return Err(ImportError::LeaseLost.into());
    }
    job.team_id.try_into().map_err(internal)
}

async fn terminal(
    connection: &mut PgConnection,
    event: &ImportEvent,
    status: &str,
    error: Option<ImportError>,
) -> PortResult<()> {
    let error = error.map(enum_string).transpose()?;
    sqlx::query!(
        r#"UPDATE slack_import_conversation SET status = $3, last_error = $4,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           settled_at = clock_timestamp(), updated_at = clock_timestamp()
           WHERE job_id = $1 AND slack_channel_id = $2"#,
        Uuid::from(event.job_id),
        event.slack_channel_id.as_str(),
        status,
        error,
    )
    .execute(&mut *connection)
    .await
    .map_err(internal)?;
    sqlx::query!(
        r#"UPDATE slack_import_outbox SET cancelled_at = clock_timestamp()
           WHERE job_id = $1 AND slack_channel_id = $2 AND kind = 'import'
             AND published_at IS NULL AND cancelled_at IS NULL"#,
        Uuid::from(event.job_id),
        event.slack_channel_id.as_str(),
    )
    .execute(&mut *connection)
    .await
    .map_err(internal)?;
    recompute(connection, event.job_id).await
}

async fn recompute(connection: &mut PgConnection, job: JobId) -> PortResult<()> {
    // Called only under the job lock. Registration, not the presence of work,
    // determines whether the job can settle; empty finalized jobs complete too.
    sqlx::query!(
        r#"WITH result AS (
             SELECT CASE
               WHEN j.cancel_requested_at IS NOT NULL THEN CASE WHEN EXISTS (
                 SELECT 1 FROM slack_import_conversation WHERE job_id = j.id AND status = 'importing'
               ) THEN 'cancelling' ELSE 'cancelled' END
               WHEN j.registration_closed_at IS NULL THEN 'uploading'
               WHEN EXISTS (SELECT 1 FROM slack_import_conversation WHERE job_id = j.id
                    AND status IN ('awaiting_uploads', 'queued', 'importing')) THEN 'processing'
               WHEN NOT EXISTS (SELECT 1 FROM slack_import_conversation WHERE job_id = j.id AND status = 'failed') THEN 'completed'
               WHEN EXISTS (SELECT 1 FROM slack_import_conversation WHERE job_id = j.id AND (status = 'completed' OR imported > 0))
                    THEN 'completed_with_errors'
               ELSE 'failed' END AS status
             FROM slack_import_job j WHERE j.id = $1
           ) UPDATE slack_import_job j SET status = r.status, revision = revision + 1, updated_at = clock_timestamp(),
             settled_at = CASE WHEN r.status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')
                         THEN coalesce(j.settled_at, clock_timestamp()) ELSE NULL END
             FROM result r WHERE j.id = $1"#, Uuid::from(job),
    ).execute(connection).await.map_err(internal)?;
    Ok(())
}

async fn verified_uploads(
    connection: &mut PgConnection,
    event: &ImportEvent,
) -> PortResult<Vec<VerifiedUpload>> {
    let rows = sqlx::query!(
        r#"SELECT slack_channel_id, part_index, object_key, sha256, byte_length, record_count,
           verified_version_id, verified_etag FROM slack_import_upload
           WHERE job_id = $1 AND (slack_channel_id IS NULL OR slack_channel_id = $2)
           AND verified_at IS NOT NULL ORDER BY part_index NULLS FIRST"#,
        Uuid::from(event.job_id),
        event.slack_channel_id.as_str(),
    )
    .fetch_all(connection)
    .await
    .map_err(internal)?;
    rows.into_iter()
        .map(|r| {
            let upload = match r.part_index {
                Some(index) => UploadId::ConversationPart {
                    slack_channel_id: event.slack_channel_id.clone(),
                    part_index: index as u32,
                },
                None => UploadId::Users,
            };
            let identity = match (r.verified_version_id, r.verified_etag) {
                (Some(value), _) => ObjectIdentity::Version(value.parse().map_err(internal)?),
                (_, Some(value)) => ObjectIdentity::EntityTag(value.parse().map_err(internal)?),
                _ => return Err(ImportError::Internal.into()),
            };
            Ok(VerifiedUpload {
                registered: RegisteredUpload {
                    descriptor: UploadDescriptor {
                        upload,
                        sha256: r.sha256.parse().map_err(internal)?,
                        byte_length: r.byte_length as u64,
                        record_count: r.record_count.map(|n| n as u32),
                    },
                    key: r.object_key.parse().map_err(internal)?,
                },
                identity,
            })
        })
        .collect()
}

fn timestamp(micros: i64) -> PortResult<SlackTimestamp> {
    format!("{}.{:06}", micros / 1_000_000, micros % 1_000_000)
        .parse()
        .map_err(internal)
}

pub(super) fn number(value: u64) -> PortResult<i64> {
    i64::try_from(value).map_err(|_| ImportError::InvalidInput.into())
}

pub(super) fn enum_string(value: impl serde::Serialize) -> PortResult<String> {
    serde_json::to_value(value)
        .map_err(internal)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| ImportError::Internal.into())
}
