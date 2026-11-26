use super::*;
use crate::domain::mailbox::parked_work_recovery::{
    ParkedWorkRecoveryPage, ParkedWorkRecoveryRepository,
};
use sqlx::Acquire;
use std::time::Duration;

/// Only local parking is cleared: provider not-before times and leases survive.
/// Call after the parent activation UPDATE while that transaction holds its lock.
async fn unpark_projection_page(
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

#[derive(Clone, Copy)]
enum ParkedWork {
    Projection,
    Streams,
    Messages,
    Drafts,
    Commands,
}

impl ParkedWork {
    fn as_str(self) -> &'static str {
        match self {
            Self::Projection => "projection",
            Self::Streams => "streams",
            Self::Messages => "reconciliation",
            Self::Drafts => "drafts",
            Self::Commands => "commands",
        }
    }
}

/// Share the first page so an unbounded family cannot keep another family's
/// head parked. A bounded second pass borrows unused quota from exhausted work.
/// No recovery statement changes a real retry floor or a lease deadline.
pub async fn unpark_link_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
) -> Result<u64, sqlx::Error> {
    let limit = limit.min(64);
    if limit == 0 {
        return Ok(0);
    }
    const FAMILY_COUNT: usize = 5;
    const FAMILIES: [ParkedWork; FAMILY_COUNT] = [
        ParkedWork::Projection,
        ParkedWork::Streams,
        ParkedWork::Messages,
        ParkedWork::Drafts,
        ParkedWork::Commands,
    ];
    let extra = (limit % FAMILY_COUNT as u32) as usize;
    let mut saturated = [false; FAMILY_COUNT];
    let mut remaining = limit;
    for (index, family) in FAMILIES.iter().enumerate() {
        let quota = limit / FAMILY_COUNT as u32 + u32::from(index < extra);
        if quota == 0 {
            // Small or halved pages must still try this family when another
            // family leaves room; otherwise the sweep can falsely see an end.
            saturated[index] = true;
            continue;
        }
        // Each family updates at most its SQL LIMIT, which is at most 64.
        let changed = unpark_work_page(connection, link, quota, *family).await? as u32;
        saturated[index] = changed == quota;
        remaining -= changed;
    }
    for (index, family) in FAMILIES.iter().enumerate() {
        if remaining == 0 {
            break;
        }
        if !saturated[index] {
            continue;
        }
        let changed = unpark_work_page(connection, link, remaining, *family).await? as u32;
        remaining -= changed;
    }
    Ok(u64::from(limit - remaining))
}

#[tracing::instrument(skip_all, name = "email.mailbox.unpark_family", fields(
    mailbox.link_id = %link,
    mailbox.work = work.as_str(),
    mailbox.rows_unparked = tracing::field::Empty,
), err)]
async fn unpark_work_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
    work: ParkedWork,
) -> Result<u64, sqlx::Error> {
    let rows = match work {
        ParkedWork::Projection => unpark_projection_page(connection, link, limit).await,
        ParkedWork::Streams => unpark_stream_page(connection, link, limit).await,
        ParkedWork::Messages => unpark_message_page(connection, link, limit).await,
        ParkedWork::Drafts => unpark_draft_page(connection, link, limit).await,
        ParkedWork::Commands => unpark_command_page(connection, link, limit).await,
    }?;
    tracing::Span::current().record("mailbox.rows_unparked", rows);
    Ok(rows)
}

/// Generation and kind are index keys, so stale or unavailable folders are
/// excluded by an index range rather than filtered across a whole backlog.
async fn unpark_stream_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
) -> Result<u64, sqlx::Error> {
    let remaining = i64::from(limit);
    Ok(sqlx::query!(
        r#"
        WITH parent AS MATERIALIZED (
            SELECT sync_generation, mailbox_unavailable_at FROM email_links
            WHERE id = $1 AND is_sync_active AND NOT needs_reauth
        ), healthy AS MATERIALIZED (
            SELECT s.id FROM parent p JOIN email_sync_streams s
                ON s.link_id = $1 AND s.generation = p.sync_generation
            WHERE p.mailbox_unavailable_at IS NULL AND s.parked_at IS NOT NULL
            ORDER BY s.kind, s.id LIMIT $2 FOR UPDATE OF s SKIP LOCKED
        ), catalogs AS MATERIALIZED (
            SELECT s.id FROM parent p JOIN email_sync_streams s
                ON s.link_id = $1 AND s.generation = p.sync_generation
            WHERE p.mailbox_unavailable_at IS NOT NULL AND s.kind = 'folder_catalog'
                AND s.parked_at IS NOT NULL
            ORDER BY s.id LIMIT $2 FOR UPDATE OF s SKIP LOCKED
        ), targets AS (
            SELECT id FROM healthy UNION ALL SELECT id FROM catalogs
        )
        UPDATE email_sync_streams s SET parked_at = NULL
        FROM targets t WHERE s.id = t.id
        "#,
        link,
        remaining,
    )
    .execute(connection)
    .await?
    .rows_affected())
}

async fn unpark_message_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
) -> Result<u64, sqlx::Error> {
    let remaining = i64::from(limit);
    Ok(sqlx::query!(
        r#"
        WITH parent AS MATERIALIZED (
            SELECT sync_generation FROM email_links
            WHERE id = $1 AND is_sync_active AND NOT needs_reauth
                AND mailbox_unavailable_at IS NULL
        ), parked AS MATERIALIZED (
            SELECT q.link_id, q.generation, q.provider_id
            FROM parent p JOIN email_message_reconciliation q
                ON q.link_id = $1 AND q.generation = p.sync_generation
            WHERE q.parked_at IS NOT NULL
            ORDER BY q.provider_id LIMIT $2 FOR UPDATE OF q SKIP LOCKED
        )
        UPDATE email_message_reconciliation q SET parked_at = NULL
        FROM parked p WHERE (q.link_id, q.generation, q.provider_id) =
            (p.link_id, p.generation, p.provider_id)
        "#,
        link,
        remaining,
    )
    .execute(connection)
    .await?
    .rows_affected())
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
        Ok(Err(error)) => {
            tracing::warn!(?error, mailbox.link_id = %link, "parked mailbox work tail retained for maintenance")
        }
        Err(_) => tracing::warn!(
            mailbox.link_id = %link,
            "parked mailbox work tail exceeded connect budget; retained for maintenance"
        ),
    }
}

async fn unpark_draft_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query_file!(
        "src/outbound/mailbox_pg/mutation_claims/unpark_drafts.sql",
        link,
        i64::from(limit)
    )
    .execute(connection)
    .await?
    .rows_affected())
}

async fn unpark_command_page(
    connection: &mut sqlx::PgConnection,
    link: Uuid,
    limit: u32,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query_file!(
        "src/outbound/mailbox_pg/mutation_claims/unpark_commands.sql",
        link,
        i64::from(limit)
    )
    .execute(connection)
    .await?
    .rows_affected())
}

impl PgMailboxSync {
    async fn advance_parked_work_recovery(
        &self,
        limit: u32,
    ) -> Result<Option<ParkedWorkRecoveryPage>, MailboxError> {
        let limit = limit.clamp(1, 64);
        let mut page = ParkedWorkRecoveryPage {
            links_scanned: 0,
            rows_unparked: 0,
            failed_probes: 0,
            complete: false,
        };
        for _ in 0..limit {
            let Some(probe) = self
                .parked_work_recovery_probe(limit - page.rows_unparked)
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
    #[tracing::instrument(skip_all, name="email.mailbox.unpark_probe", fields(
        mailbox.link_id = tracing::field::Empty,
        mailbox.unpark_attempts = tracing::field::Empty,
        mailbox.unpark_limit = tracing::field::Empty,
    ), err)]
    async fn parked_work_recovery_probe(
        &self,
        row_limit: u32,
    ) -> Result<Option<ParkedWorkRecoveryPage>, MailboxError> {
        let span = tracing::Span::current();
        span.record("mailbox.unpark_attempts", 0u32);
        span.record("mailbox.unpark_limit", row_limit);
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
        let next = sqlx::query_scalar!(
            r#"
                SELECT link_id AS "link_id!" FROM (
                    (SELECT link_id FROM email_projection_outbox
                        WHERE parked_at IS NOT NULL AND link_id > $1
                        ORDER BY link_id LIMIT 1)
                    UNION ALL
                    (SELECT link_id FROM email_sync_streams
                        WHERE parked_at IS NOT NULL AND link_id > $1
                        ORDER BY link_id LIMIT 1)
                    UNION ALL
                    (SELECT link_id FROM email_message_reconciliation
                        WHERE parked_at IS NOT NULL AND link_id > $1
                        ORDER BY link_id LIMIT 1)
                    UNION ALL
                    (SELECT link_id FROM email_mailbox_drafts
                        WHERE parked_at IS NOT NULL AND link_id > $1
                        ORDER BY link_id LIMIT 1)
                    UNION ALL
                    (SELECT link_id FROM email_mailbox_commands
                        WHERE parked_at IS NOT NULL AND link_id > $1
                        ORDER BY link_id LIMIT 1)
                ) next_links ORDER BY link_id LIMIT 1
                "#,
            cursor
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        let Some(link) = next else {
            complete = true;
            cursor = Uuid::nil();
            sqlx::query!(
                    "UPDATE email_projection_unpark_sweep SET link_after=$1,available_at=now()+interval '5 minutes',last_completed_at=now() WHERE id=true",
                    cursor
                ).execute(&mut *tx).await.map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            return Ok(Some(ParkedWorkRecoveryPage {
                links_scanned: 0,
                rows_unparked: 0,
                failed_probes: 0,
                complete,
            }));
        };
        scanned += 1;
        tracing::Span::current().record("mailbox.link_id", link.to_string());
        // Savepoint failure cannot poison the singleton transaction. Once
        // the link is known, a timed-out probe advances past it until wrap.
        let mut attempt_limit = row_limit;
        let mut attempts = 0u32;
        loop {
            attempts += 1;
            span.record("mailbox.unpark_attempts", attempts);
            span.record("mailbox.unpark_limit", attempt_limit);
            let mut work = tx.begin().await.map_err(db_error)?;
            let result = async {
                let active =
                    sqlx::query_scalar!("SELECT is_sync_active FROM email_links WHERE id=$1", link)
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
                    unparked = changed as u32;
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
        Ok(Some(ParkedWorkRecoveryPage {
            links_scanned: scanned,
            rows_unparked: unparked,
            failed_probes,
            complete,
        }))
    }
}

impl ParkedWorkRecoveryRepository for PgMailboxSync {
    async fn recover_page(
        &self,
        limit: u32,
    ) -> Result<Option<ParkedWorkRecoveryPage>, MailboxError> {
        match tokio::time::timeout(Duration::from_secs(1), self.cleanup_command_quarantine()).await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(?error, "Quarantined mailbox command cleanup unavailable")
            }
            Err(_) => tracing::warn!("Quarantined mailbox command cleanup deadline exceeded"),
        }
        // This is an absolute page budget, not a fresh timeout for each probe.
        tokio::time::timeout(
            self.recovery_page_budget,
            self.advance_parked_work_recovery(limit),
        )
        .await
        .map_err(|_| MailboxError::database(DatabaseFailure::DeadlineExceeded))?
        .map_err(super::mutation_claims::database_deadline)
    }
}
