//! Leased, atomic keyset pages for the legacy reconciliation provider repair.
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

struct Cursor {
    phase: RepairPhase,
    link_after: Uuid,
    pending_links: Vec<Uuid>,
    current_link: Option<Uuid>,
    generation_after: i64,
    provider_id_after: String,
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
            batches,
            link_rows_scanned,
            message_rows_scanned,
            rows_repaired
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
        progress: RepairProgress {
            batches: row.batches,
            link_rows_scanned: row.link_rows_scanned,
            message_rows_scanned: row.message_rows_scanned,
            rows_repaired: row.rows_repaired,
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
                j.rows_repaired
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
                },
            }));
        }
        let completed = sqlx::query!(
            r#"
            SELECT
                batches,
                link_rows_scanned,
                message_rows_scanned,
                rows_repaired
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
            // A deleted link needs no legacy repair.
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
            // The lateral key order keeps even empty-link lookups on the PK
            // when a few huge mailboxes skew the planner's per-link estimate.
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
                    COALESCE(array_agg(p.id ORDER BY p.id)
                        FILTER (WHERE first_work.provider_id IS NOT NULL), '{}'::uuid[]) AS "links!",
                    (SELECT id FROM page ORDER BY id DESC LIMIT 1) AS last_id
                FROM page p
                LEFT JOIN LATERAL (
                    SELECT r.provider_id
                    FROM email_message_reconciliation r
                    WHERE r.link_id = p.id
                        AND p.provider IS DISTINCT FROM 'OUTLOOK'
                    ORDER BY r.generation, r.provider_id
                    LIMIT 1
                ) first_work ON true
                "#,
                cursor.link_after,
                PAGE_SIZE,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(failure)?;
            cursor.progress.link_rows_scanned += page.scanned;
            cursor.pending_links = page.links;
            match page.last_id {
                Some(last) => cursor.link_after = last,
                None => cursor.phase = RepairPhase::Complete,
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

    async fn defer(&self, lease: RepairLease, seconds: u32) -> Result<RepairProgress, RepairError> {
        let row = sqlx::query!(
            r#"
            UPDATE email_reconciliation_provider_backfill
            SET
                available_at = clock_timestamp() + make_interval(secs => $2),
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
                rows_repaired
            "#,
            lease.id,
            f64::from(seconds),
        )
        .fetch_optional(&self.0)
        .await
        .map_err(failure)?
        .ok_or(RepairError::LeaseLost)?;
        Ok(RepairProgress {
            batches: row.batches,
            link_rows_scanned: row.link_rows_scanned,
            message_rows_scanned: row.message_rows_scanned,
            rows_repaired: row.rows_repaired,
        })
    }
}

#[cfg(test)]
mod test;
