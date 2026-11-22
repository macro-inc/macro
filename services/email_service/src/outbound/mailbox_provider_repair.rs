//! Leased, atomic keyset pages for the legacy reconciliation provider repair.
use chrono::{DateTime, Utc};
use email::domain::mailbox::provider_repair::*;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub struct PgProviderRepair(pub PgPool);

fn failure(error: sqlx::Error) -> RepairError {
    match error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
    {
        Some("55P03") => RepairError::LockBusy,
        Some("57014" | "25P03") => RepairError::Deadline,
        _ => RepairError::Unavailable,
    }
}

fn validation_failure(error: sqlx::Error, target: ValidationTarget) -> RepairError {
    if error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
        == Some("23503")
    {
        return RepairError::ConstraintViolation(target);
    }
    failure(error)
}

struct Cursor {
    phase: RepairPhase,
    link_after: Uuid,
    pending_links: Vec<Uuid>,
    current_link: Option<Uuid>,
    generation_after: i64,
    provider_id_after: String,
    scan_completed_at: Option<DateTime<Utc>>,
    progress: RepairProgress,
}

async fn locked(
    tx: &mut Transaction<'_, Postgres>,
    lease: RepairLease,
) -> Result<Cursor, RepairError> {
    let row = sqlx::query!(
        r#"
        SELECT
            phase,
            link_after,
            pending_links,
            current_link,
            generation_after,
            provider_id_after,
            scan_completed_at,
            batches,
            link_rows_scanned,
            message_rows_scanned,
            rows_repaired,
            validation_failures,
            constraint_failures
        FROM email_reconciliation_provider_backfill
        WHERE name = 'v1'
            AND lease_id = $1
            AND lease_until > clock_timestamp()
        FOR UPDATE
        "#,
        lease.id,
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .ok_or(RepairError::LeaseLost)?;
    let phase = row.phase.parse().map_err(|_| RepairError::InvalidState)?;
    if phase != lease.phase {
        return Err(RepairError::LeaseLost);
    }
    Ok(Cursor {
        phase,
        link_after: row.link_after,
        pending_links: row.pending_links,
        current_link: row.current_link,
        generation_after: row.generation_after,
        provider_id_after: row.provider_id_after,
        scan_completed_at: row.scan_completed_at,
        progress: RepairProgress {
            batches: row.batches,
            link_rows_scanned: row.link_rows_scanned,
            message_rows_scanned: row.message_rows_scanned,
            rows_repaired: row.rows_repaired,
            validation_failures: row.validation_failures,
            constraint_failures: row.constraint_failures,
        },
    })
}

async fn save(
    tx: &mut Transaction<'_, Postgres>,
    lease: RepairLease,
    cursor: &Cursor,
) -> Result<(), RepairError> {
    let changed = sqlx::query!(
        r#"
        UPDATE email_reconciliation_provider_backfill
        SET
            phase = $2,
            link_after = $3,
            pending_links = $4,
            current_link = $5,
            generation_after = $6,
            provider_id_after = $7,
            batches = $8,
            link_rows_scanned = $9,
            message_rows_scanned = $10,
            rows_repaired = $11,
            scan_completed_at = CASE
                WHEN $2 <> 'scanning' THEN COALESCE(scan_completed_at, clock_timestamp())
                ELSE scan_completed_at
            END,
            completed_at = CASE WHEN $2 = 'complete' THEN clock_timestamp() END,
            lease_id = NULL,
            lease_until = NULL,
            available_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE name = 'v1'
            AND lease_id = $1
            AND lease_until > clock_timestamp()
        "#,
        lease.id,
        cursor.phase.as_ref(),
        cursor.link_after,
        &cursor.pending_links,
        cursor.current_link,
        cursor.generation_after,
        &cursor.provider_id_after,
        cursor.progress.batches,
        cursor.progress.link_rows_scanned,
        cursor.progress.message_rows_scanned,
        cursor.progress.rows_repaired,
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?
    .rows_affected();
    if changed != 1 {
        return Err(RepairError::LeaseLost);
    }
    Ok(())
}

impl ProviderRepairRepository for PgProviderRepair {
    async fn claim(&self, id: Uuid) -> Result<RepairClaim, RepairError> {
        let row = sqlx::query!(
            r#"
            WITH candidate AS (
                SELECT name
                FROM email_reconciliation_provider_backfill
                WHERE name = 'v1'
                    AND phase <> 'complete'
                    AND available_at <= clock_timestamp()
                    AND (lease_until IS NULL OR lease_until < clock_timestamp())
                FOR UPDATE SKIP LOCKED
            )
            UPDATE email_reconciliation_provider_backfill j
            SET
                lease_id = $1,
                lease_until = clock_timestamp() + make_interval(secs => $2),
                updated_at = clock_timestamp()
            FROM candidate c
            WHERE j.name = c.name
            RETURNING
                j.phase,
                j.batches,
                j.link_rows_scanned,
                j.message_rows_scanned,
                j.rows_repaired,
                j.validation_failures,
                j.constraint_failures
            "#,
            id,
            f64::from(LEASE_SECONDS),
        )
        .fetch_optional(&self.0)
        .await
        .map_err(failure)?;
        if let Some(row) = row {
            return Ok(RepairClaim::Acquired(RepairLease {
                id,
                phase: row.phase.parse().map_err(|_| RepairError::InvalidState)?,
                progress: RepairProgress {
                    batches: row.batches,
                    link_rows_scanned: row.link_rows_scanned,
                    message_rows_scanned: row.message_rows_scanned,
                    rows_repaired: row.rows_repaired,
                    validation_failures: row.validation_failures,
                    constraint_failures: row.constraint_failures,
                },
            }));
        }
        let completed = sqlx::query!(
            r#"
            SELECT
                batches,
                link_rows_scanned,
                message_rows_scanned,
                rows_repaired,
                validation_failures,
                constraint_failures
            FROM email_reconciliation_provider_backfill
            WHERE name = 'v1'
                AND phase = 'complete'
            "#,
        )
        .fetch_optional(&self.0)
        .await
        .map_err(failure)?;
        Ok(match completed {
            Some(row) => RepairClaim::Complete(RepairProgress {
                batches: row.batches,
                link_rows_scanned: row.link_rows_scanned,
                message_rows_scanned: row.message_rows_scanned,
                rows_repaired: row.rows_repaired,
                validation_failures: row.validation_failures,
                constraint_failures: row.constraint_failures,
            }),
            None => RepairClaim::Busy,
        })
    }

    async fn scan(&self, lease: RepairLease) -> Result<RepairBatch, RepairError> {
        let mut tx = self.0.begin().await.map_err(failure)?;
        sqlx::query!("SET LOCAL statement_timeout = '10s'")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        sqlx::query!("SET LOCAL lock_timeout = '1s'")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        sqlx::query!("SET LOCAL idle_in_transaction_session_timeout = '10s'")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        let mut cursor = locked(&mut tx, lease).await?;
        if cursor.phase != RepairPhase::Scanning {
            return Err(RepairError::InvalidState);
        }
        if cursor.current_link.is_none() && !cursor.pending_links.is_empty() {
            cursor.current_link = Some(cursor.pending_links.remove(0));
            cursor.generation_after = i64::MIN;
            cursor.provider_id_after.clear();
        }
        if let Some(link) = cursor.current_link {
            // Parent before children, matching the existing FK/trigger lock order.
            // A deleted link, or one changed to Outlook, needs no legacy repair.
            let parent = sqlx::query_scalar!(
                r#"
                SELECT id
                FROM email_links
                WHERE id = $1
                    AND provider IS DISTINCT FROM 'OUTLOOK'
                FOR KEY SHARE
                "#,
                link,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(failure)?;
            if parent.is_some() {
                let page = sqlx::query!(
                    r#"
                    WITH page AS MATERIALIZED (
                        SELECT generation, provider_id
                        FROM email_message_reconciliation
                        WHERE link_id = $1
                            AND (generation, provider_id) > ($2, $3)
                        ORDER BY generation, provider_id
                        LIMIT $4
                        FOR UPDATE
                    ), repaired AS (
                        UPDATE email_message_reconciliation q
                        SET provider = l.provider
                        FROM page p
                        JOIN email_links l ON l.id = $1
                        WHERE q.link_id = $1
                            AND q.generation = p.generation
                            AND q.provider_id = p.provider_id
                            AND l.provider IS DISTINCT FROM 'OUTLOOK'
                            AND q.provider IS DISTINCT FROM l.provider
                        RETURNING q.provider_id
                    )
                    SELECT
                        count(*) AS "scanned!",
                        (
                            SELECT count(*)
                            FROM repaired
                        ) AS "repaired!",
                        (
                            SELECT generation
                            FROM page
                            ORDER BY generation DESC, provider_id DESC
                            LIMIT 1
                        ) AS last_generation,
                        (
                            SELECT provider_id
                            FROM page
                            ORDER BY generation DESC, provider_id DESC
                            LIMIT 1
                        ) AS last_provider_id
                    FROM page
                    "#,
                    link,
                    cursor.generation_after,
                    &cursor.provider_id_after,
                    PAGE_SIZE,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(failure)?;
                cursor.progress.message_rows_scanned += page.scanned;
                cursor.progress.rows_repaired += page.repaired;
                match (page.last_generation, page.last_provider_id) {
                    (Some(generation), Some(id)) => {
                        cursor.generation_after = generation;
                        cursor.provider_id_after = id;
                    }
                    (None, None) => cursor.current_link = None,
                    _ => return Err(RepairError::InvalidState),
                }
            } else {
                cursor.current_link = None;
            }
        } else {
            // Bound the parent page BEFORE provider filtering. Store its bounded
            // non-Outlook list so dense cohorts do not repeatedly scan the page.
            let page = sqlx::query!(
                r#"
                WITH page AS MATERIALIZED (
                    SELECT id, provider
                    FROM email_links
                    WHERE id > $1
                    ORDER BY id
                    LIMIT $2
                )
                SELECT
                    count(*) AS "scanned!",
                    COALESCE(array_agg(id ORDER BY id)
                        FILTER (WHERE provider IS DISTINCT FROM 'OUTLOOK'), '{}'::uuid[]) AS "links!",
                    (
                        SELECT id
                        FROM page
                        ORDER BY id DESC
                        LIMIT 1
                    ) AS last_id
                FROM page
                "#,
                cursor.link_after,
                PAGE_SIZE,
            )
            .fetch_one(&mut *tx).await.map_err(failure)?;
            cursor.progress.link_rows_scanned += page.scanned;
            cursor.pending_links = page.links;
            match page.last_id {
                Some(last) => cursor.link_after = last,
                None => cursor.phase = RepairPhase::Validating,
            }
        }
        cursor.progress.batches += 1;
        save(&mut tx, lease, &cursor).await?;
        tx.commit().await.map_err(failure)?;
        Ok(RepairBatch {
            phase: cursor.phase,
            progress: cursor.progress,
        })
    }

    async fn validate(&self, lease: RepairLease) -> Result<RepairProgress, RepairError> {
        let mut tx = self.0.begin().await.map_err(failure)?;
        sqlx::query!("SET LOCAL statement_timeout = '60s'")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        sqlx::query!("SET LOCAL lock_timeout = '1s'")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        sqlx::query!("SET LOCAL idle_in_transaction_session_timeout = '10s'")
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        let mut cursor = locked(&mut tx, lease).await?;
        if cursor.phase != RepairPhase::Validating || cursor.scan_completed_at.is_none() {
            return Err(RepairError::InvalidState);
        }
        // Each of the two scans has a 60-second statement budget, so their
        // combined work stays below the same 180-second maintenance lease.
        sqlx::query!(
            r#"
            ALTER TABLE email_sync_streams
            VALIDATE CONSTRAINT email_sync_streams_link_provider_fkey
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| validation_failure(error, ValidationTarget::Streams))?;
        sqlx::query!(
            r#"
            ALTER TABLE email_message_reconciliation
            VALIDATE CONSTRAINT email_message_reconciliation_link_provider_fkey
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| validation_failure(error, ValidationTarget::Reconciliation))?;
        cursor.phase = RepairPhase::Complete;
        cursor.current_link = None;
        cursor.pending_links.clear();
        save(&mut tx, lease, &cursor).await?;
        tx.commit().await.map_err(failure)?;
        Ok(cursor.progress)
    }

    async fn defer(
        &self,
        lease: RepairLease,
        seconds: u32,
        reason: ValidationDeferral,
    ) -> Result<RepairProgress, RepairError> {
        let row = sqlx::query!(
            r#"
            UPDATE email_reconciliation_provider_backfill
            SET
                available_at = clock_timestamp() + make_interval(secs => $2),
                validation_failures = validation_failures + CASE
                    WHEN phase = 'validating' AND $3 IN ('transient_failure', 'constraint_violation') THEN 1
                    ELSE 0
                END,
                constraint_failures = CASE
                    WHEN phase = 'validating' AND $3 = 'constraint_violation'
                        THEN LEAST(constraint_failures + 1, $4)
                    ELSE constraint_failures
                END,
                lease_id = NULL,
                lease_until = NULL,
                updated_at = clock_timestamp()
            WHERE name = 'v1'
                AND lease_id = $1
                AND lease_until > clock_timestamp()
            RETURNING
                batches,
                link_rows_scanned,
                message_rows_scanned,
                rows_repaired,
                validation_failures,
                constraint_failures
            "#,
            lease.id,
            f64::from(seconds),
            reason.as_ref(),
            MAX_CONSTRAINT_FAILURES,
        )
        .fetch_optional(&self.0).await.map_err(failure)?
        .ok_or(RepairError::LeaseLost)?;
        Ok(RepairProgress {
            batches: row.batches,
            link_rows_scanned: row.link_rows_scanned,
            message_rows_scanned: row.message_rows_scanned,
            rows_repaired: row.rows_repaired,
            validation_failures: row.validation_failures,
            constraint_failures: row.constraint_failures,
        })
    }
}

#[cfg(test)]
mod test;
