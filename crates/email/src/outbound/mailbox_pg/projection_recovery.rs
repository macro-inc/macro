use super::*;
use crate::domain::mailbox::projection_recovery::{
    ProjectionRecoveryPage, ProjectionRecoveryRepository,
};
use sqlx::Acquire;
use std::time::Duration;

/// Retain the current attempt even when an absolute deadline drops the future.
struct ProjectionProbeObservation {
    span: tracing::Span,
    attempts: u32,
    limit: u32,
    discovery_skipped: bool,
}

impl Drop for ProjectionProbeObservation {
    fn drop(&mut self) {
        self.span
            .record("projection.unpark_attempts", self.attempts);
        self.span.record("projection.unpark_limit", self.limit);
        self.span
            .record("projection.discovery_skipped", self.discovery_skipped);
    }
}

/// Only local parking is cleared: provider not-before times and leases survive.
/// Call after the parent activation UPDATE while that transaction holds its lock.
pub async fn unpark_link_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
) -> Result<u64, sqlx::Error> {
    let updated = sqlx::query!(
        r#"
        WITH parked AS MATERIALIZED (
            SELECT o.id FROM email_projection_outbox o
            WHERE o.link_id=$1 AND o.parked_at IS NOT NULL
                AND EXISTS (SELECT 1 FROM email_links l WHERE l.id=$1 AND l.is_sync_active)
            ORDER BY o.seq NULLS FIRST,o.id LIMIT $2
            FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE email_projection_outbox o SET parked_at=NULL
        FROM parked p WHERE o.id=p.id
        "#,
        link,
        i64::from(limit)
    )
    .execute(connection)
    .await?;
    Ok(updated.rows_affected())
}

/// Connect must not wait for an unbounded outbox. The singleton sweep completes
/// any tail or interrupted page; each page releases its connection on commit.
pub async fn resume_link(pool: &PgPool, link: Uuid) {
    let work = async {
        for _ in 0..32 {
            let mut tx = pool.begin().await?;
            sqlx::query!("SET LOCAL statement_timeout = '2s'")
                .execute(&mut *tx)
                .await?;
            sqlx::query!("SET LOCAL lock_timeout = '1s'")
                .execute(&mut *tx)
                .await?;
            let count = unpark_link_page(&mut tx, link, 64).await?;
            tx.commit().await?;
            if count < 64 {
                break;
            }
        }
        Ok::<(), sqlx::Error>(())
    };
    match tokio::time::timeout(Duration::from_secs(2), work).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::warn!(?error, "projection unpark tail retained for maintenance"),
        Err(_) => tracing::warn!(
            "projection unpark tail exceeded connect budget; retained for maintenance"
        ),
    }
}

impl PgMailboxSync {
    async fn advance_projection_recovery(
        &self,
        limit: u32,
    ) -> Result<Option<ProjectionRecoveryPage>, MailboxError> {
        let limit = limit.clamp(1, 64);
        let mut page = ProjectionRecoveryPage {
            links_scanned: 0,
            rows_unparked: 0,
            failed_probes: 0,
            complete: false,
        };
        for _ in 0..limit {
            let Some(probe) = self
                .projection_recovery_probe(limit - page.rows_unparked)
                .await?
            else {
                return Ok((page.links_scanned > 0).then_some(page));
            };
            page.links_scanned += probe.links_scanned;
            page.rows_unparked += probe.rows_unparked;
            page.failed_probes += probe.failed_probes;
            page.complete = probe.complete;
            if page.complete || page.rows_unparked == limit {
                break;
            }
        }
        Ok(Some(page))
    }

    /// Each probe really commits its cursor. An outer deadline can only roll
    /// back the current probe, never the progress of earlier links in a page.
    #[tracing::instrument(skip_all, name="email.projection.unpark_probe", fields(
        projection.link_id = tracing::field::Empty,
        projection.unpark_attempts = tracing::field::Empty,
        projection.unpark_limit = tracing::field::Empty,
        projection.discovery_skipped = tracing::field::Empty,
    ), err)]
    async fn projection_recovery_probe(
        &self,
        row_limit: u32,
    ) -> Result<Option<ProjectionRecoveryPage>, MailboxError> {
        let mut observation = ProjectionProbeObservation {
            span: tracing::Span::current(),
            attempts: 0,
            limit: row_limit,
            discovery_skipped: false,
        };
        let mut tx = self.begin().await.map_err(db_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '250ms'")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        let Some(job) = sqlx::query!(
            r#"
            SELECT link_after FROM email_projection_unpark_sweep
            WHERE id=true AND available_at<=now()
            FOR UPDATE SKIP LOCKED
            "#
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        else {
            return Ok(None);
        };
        let mut cursor = job.link_after;
        let mut scanned = 0u32;
        let mut unparked = 0u32;
        let mut failed_probes = 0u32;
        let mut complete = false;
        // The index prefix skips a whole dead mailbox's backlog in one
        // descent. No row lock here: a locked prefix must still advance.
        let mut discovery = tx.begin().await.map_err(db_error)?;
        let next = sqlx::query_scalar!(
            r#"
                SELECT link_id FROM email_projection_outbox
                WHERE parked_at IS NOT NULL AND link_id>$1
                ORDER BY link_id LIMIT 1
                "#,
            cursor
        )
        .fetch_optional(&mut *discovery)
        .await;
        let (next, discovery_skipped) = match next {
            Ok(next) => {
                discovery.commit().await.map_err(db_error)?;
                (next, false)
            }
            Err(error) => {
                discovery.rollback().await.map_err(db_error)?;
                if error
                    .as_database_error()
                    .and_then(|error| error.code())
                    .as_deref()
                    != Some("57014")
                {
                    return Err(db_error(error));
                }
                // A bloated parked index must not pin the singleton. Advance
                // by one cheap parent-key probe, then retry skipped work at wrap.
                observation.discovery_skipped = true;
                let next = sqlx::query_scalar!(
                    "SELECT id FROM email_links WHERE id>$1 ORDER BY id LIMIT 1",
                    cursor
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_error)?;
                (next, true)
            }
        };
        let Some(link) = next else {
            complete = true;
            cursor = Uuid::nil();
            sqlx::query!(
                    "UPDATE email_projection_unpark_sweep SET link_after=$1,available_at=now()+interval '5 minutes',last_completed_at=now() WHERE id=true",
                    cursor
                ).execute(&mut *tx).await.map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            return Ok(Some(ProjectionRecoveryPage {
                links_scanned: 0,
                rows_unparked: 0,
                failed_probes: u32::from(discovery_skipped),
                complete,
            }));
        };
        scanned += 1;
        tracing::Span::current().record("projection.link_id", link.to_string());
        // Savepoint failure cannot poison the singleton transaction. Once
        // the link is known, a timed-out probe advances past it until wrap.
        if discovery_skipped {
            cursor = link;
            failed_probes = 1;
        } else {
            let mut attempt_limit = row_limit;
            loop {
                observation.attempts += 1;
                observation.limit = attempt_limit;
                let mut work = tx.begin().await.map_err(db_error)?;
                let result = async {
                    let active = sqlx::query_scalar!(
                        "SELECT is_sync_active FROM email_links WHERE id=$1",
                        link
                    )
                    .fetch_optional(&mut *work)
                    .await?
                    .unwrap_or(false);
                    if active {
                        unpark_link_page(&mut work, link, attempt_limit).await
                    } else {
                        Ok(0)
                    }
                }
                .await;
                match result {
                    Ok(changed) => {
                        work.commit().await.map_err(db_error)?;
                        unparked = u32::try_from(changed).map_err(|_| MailboxError::Persistence)?;
                        if unparked < attempt_limit {
                            cursor = link;
                        }
                        break;
                    }
                    Err(_) => {
                        work.rollback().await.map_err(db_error)?;
                        if attempt_limit > 1 {
                            attempt_limit = (attempt_limit / 2).max(1);
                            continue;
                        }
                        cursor = link;
                        failed_probes = 1;
                        break;
                    }
                }
            }
        }
        sqlx::query!(
            r#"
            UPDATE email_projection_unpark_sweep
            SET link_after=$1,
                available_at=CASE WHEN $2 THEN now()+interval '5 minutes' ELSE now() END,
                last_completed_at=CASE WHEN $2 THEN now() ELSE last_completed_at END,
                links_scanned=links_scanned+$3,
                rows_unparked=rows_unparked+$4
            WHERE id=true
            "#,
            cursor,
            complete,
            i64::from(scanned),
            i64::from(unparked)
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(Some(ProjectionRecoveryPage {
            links_scanned: scanned,
            rows_unparked: unparked,
            failed_probes,
            complete,
        }))
    }
}

impl ProjectionRecoveryRepository for PgMailboxSync {
    async fn recover_page(
        &self,
        limit: u32,
    ) -> Result<Option<ProjectionRecoveryPage>, MailboxError> {
        // This is an absolute page budget, not a fresh timeout for each probe.
        tokio::time::timeout(
            Duration::from_secs(2),
            self.advance_projection_recovery(limit),
        )
        .await
        .map_err(|_| MailboxError::Persistence)?
    }
}
