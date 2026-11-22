//! One fleet-wide, row-bounded IMAP catch-up job. No provider IO runs here.
use super::mailbox_pg::db_error;
use crate::domain::mailbox::MailboxError;
use crate::domain::mailbox::imap_catchup::{
    CatchupLease, CatchupMode, CatchupPage, ImapCatchupRepository,
};
use sqlx::PgPool;
use uuid::Uuid;

pub struct PgImapCatchup(pub PgPool);

#[cfg(test)]
mod test;

impl ImapCatchupRepository for PgImapCatchup {
    async fn request_startup(&self, coalesce_seconds: u32) -> Result<(), MailboxError> {
        sqlx::query!(
            r#"
            UPDATE
                email_imap_host_catchup
            SET
                startup_requested_at = clock_timestamp(),
                available_at = LEAST(available_at, now())
            WHERE
                id = 1
                AND startup_requested_at IS NULL
                AND (last_startup_completed_at IS NULL
                    OR last_startup_completed_at < now() - make_interval(secs => $1))
            "#,
            f64::from(coalesce_seconds),
        )
        .execute(&self.0)
        .await
        .map_err(db_error)?;
        Ok(())
    }

    async fn claim(
        &self,
        id: Uuid,
        lease_seconds: u32,
    ) -> Result<Option<CatchupLease>, MailboxError> {
        let row = sqlx::query!(
            r#"
            WITH available AS (
                SELECT
                    id
                FROM
                    email_imap_host_catchup
                WHERE
                    id = 1
                    AND available_at <= now()
                    AND (lease_id IS NULL OR lease_until < now())
                FOR UPDATE SKIP LOCKED
            )
            UPDATE
                email_imap_host_catchup j
            SET
                lease_id = $1,
                lease_until = now() + make_interval(secs => $2),
                mode = CASE WHEN startup_requested_at IS NOT NULL THEN 'startup' ELSE mode END,
                stream_after = CASE WHEN mode = 'pending' AND startup_requested_at IS NOT NULL
                    THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE stream_after END,
                cycle_started_at = CASE WHEN stream_after = '00000000-0000-0000-0000-000000000000'::uuid
                    OR (mode = 'pending' AND startup_requested_at IS NOT NULL)
                    THEN clock_timestamp() ELSE cycle_started_at END
            FROM
                available a
            WHERE
                j.id = a.id
            RETURNING
                j.stream_after,
                j.mode
            "#,
            id,
            f64::from(lease_seconds),
        )
        .fetch_optional(&self.0)
        .await
        .map_err(db_error)?;
        row.map(|row| {
            Ok(CatchupLease {
                id,
                after: row.stream_after,
                mode: row.mode.parse().map_err(|_| MailboxError::Persistence)?,
            })
        })
        .transpose()
    }

    async fn advance(
        &self,
        lease: &CatchupLease,
        limit: u32,
        idle_seconds: u32,
    ) -> Result<CatchupPage, MailboxError> {
        let deferred = sqlx::query!(
            r#"
            SELECT
                stream_id,
                attempts,
                floor(EXTRACT(EPOCH FROM clock_timestamp() - created_at))::bigint AS "age!"
            FROM
                email_imap_host_catchup_deferred
            WHERE
                available_at <= now()
            ORDER BY
                available_at,
                stream_id
            LIMIT
                $1
            "#,
            i64::from(limit / 2),
        )
        .fetch_all(&self.0)
        .await
        .map_err(db_error)?;
        let room = limit
            .saturating_sub(u32::try_from(deferred.len()).map_err(|_| MailboxError::Persistence)?);
        let regular = match lease.mode {
            CatchupMode::Startup => sqlx::query_scalar!(
                r#"
                SELECT
                    s.id
                FROM
                    email_sync_streams s
                WHERE
                    s.provider = 'IMAP'
                    AND s.kind IN ('folder_catalog', 'mail_folder')
                    AND s.id > $1
                    AND NOT EXISTS (
                        SELECT
                            1
                        FROM
                            email_imap_host_catchup_deferred d
                        WHERE
                            d.stream_id = s.id
                    )
                ORDER BY
                    s.id
                LIMIT
                    $2
                "#,
                lease.after,
                i64::from(room),
            )
            .fetch_all(&self.0)
            .await
            .map_err(db_error)?,
            CatchupMode::Pending => sqlx::query_scalar!(
                r#"
                SELECT
                    s.id
                FROM
                    email_sync_streams s
                WHERE
                    s.provider = 'IMAP'
                    AND s.kind IN ('folder_catalog', 'mail_folder')
                    AND s.notification_revision > s.leased_notification_revision
                    AND s.id > $1
                    AND NOT EXISTS (
                        SELECT
                            1
                        FROM
                            email_imap_host_catchup_deferred d
                        WHERE
                            d.stream_id = s.id
                    )
                ORDER BY
                    s.id
                LIMIT
                    $2
                "#,
                lease.after,
                i64::from(room),
            )
            .fetch_all(&self.0)
            .await
            .map_err(db_error)?,
        };
        let ids = deferred
            .iter()
            .map(|row| row.stream_id)
            .chain(regular.iter().copied())
            .collect::<std::collections::BTreeSet<_>>();
        let mut page = CatchupPage {
            scanned: u32::try_from(ids.len()).map_err(|_| MailboxError::Persistence)?,
            woken: 0,
            deferred: 0,
            failed: 0,
            complete: room > 0
                && regular.len() < usize::try_from(room).map_err(|_| MailboxError::Persistence)?,
            deferred_attempts_max: deferred
                .iter()
                .map(|row| u32::try_from(row.attempts).unwrap_or(u32::MAX))
                .max()
                .unwrap_or(0),
            deferred_age_seconds_max: deferred
                .iter()
                .map(|row| u64::try_from(row.age.max(0)).unwrap_or(u64::MAX))
                .max()
                .unwrap_or(0),
        };
        let mut retry = Vec::new();
        let mut settled = Vec::new();
        for id in ids {
            match self.wake_one(lease, id).await {
                Ok((Some(true), _)) => {
                    page.woken += 1;
                    settled.push(id);
                }
                Ok((Some(false), _) | (None, false)) => {
                    page.deferred += 1;
                    settled.push(id);
                }
                Ok((None, true)) => {
                    page.deferred += 1;
                    retry.push(id);
                }
                Err(error) => {
                    page.failed += 1;
                    retry.push(id);
                    tracing::warn!(stream.id = %id, %error, "IMAP catch-up row deferred");
                }
            }
        }
        let after = regular.last().copied().unwrap_or(lease.after);
        let mut tx = self.0.begin().await.map_err(db_error)?;
        let owned = sqlx::query_scalar!(
            r#"
            SELECT
                id
            FROM
                email_imap_host_catchup
            WHERE
                id = 1
                AND lease_id = $1
                AND lease_until > clock_timestamp()
            FOR UPDATE
            "#,
            lease.id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        if owned.is_none() {
            return Err(MailboxError::Stale);
        }
        sqlx::query!(
            r#"
            DELETE FROM
                email_imap_host_catchup_deferred
            WHERE
                stream_id = ANY($1)
            "#,
            &settled,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query!(
            r#"
            INSERT INTO email_imap_host_catchup_deferred (
                stream_id,
                available_at,
                attempts
            )
            SELECT
                id,
                clock_timestamp() + interval '30 seconds',
                1
            FROM
                unnest($1::uuid[]) AS rows(id)
            ON CONFLICT
                (stream_id)
            DO UPDATE SET
                attempts = LEAST(email_imap_host_catchup_deferred.attempts + 1, 1000000),
                available_at = clock_timestamp() + make_interval(secs => LEAST(
                    30 * power(2, LEAST(email_imap_host_catchup_deferred.attempts, 4)), 300
                ))
            "#,
            &retry,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        let saved = sqlx::query!(
            r#"
            UPDATE
                email_imap_host_catchup
            SET
                stream_after = CASE WHEN $3 THEN '00000000-0000-0000-0000-000000000000'::uuid ELSE $2 END,
                mode = CASE WHEN $3 THEN 'pending' ELSE mode END,
                startup_requested_at = CASE WHEN $3 AND $4 THEN NULL ELSE startup_requested_at END,
                last_startup_completed_at = CASE WHEN $3 AND $4 THEN clock_timestamp() ELSE last_startup_completed_at END,
                lease_id = NULL,
                lease_until = NULL,
                available_at = CASE WHEN startup_requested_at IS NOT NULL AND NOT $4 THEN now()
                    WHEN $3 THEN now() + make_interval(secs => $5) ELSE now() END,
                batches = batches + 1,
                streams_scanned = streams_scanned + $6,
                streams_woken = streams_woken + $7,
                streams_deferred = streams_deferred + $8,
                streams_failed = streams_failed + $9,
                updated_at = clock_timestamp()
            WHERE
                id = 1
                AND lease_id = $1
                AND lease_until > clock_timestamp()
            "#,
            lease.id,
            after,
            page.complete,
            lease.mode == CatchupMode::Startup,
            f64::from(idle_seconds),
            i64::from(page.scanned),
            i64::from(page.woken),
            i64::from(page.deferred),
            i64::from(page.failed),
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if saved.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        tx.commit().await.map_err(db_error)?;
        Ok(page)
    }
}

impl PgImapCatchup {
    async fn wake_one(
        &self,
        lease: &CatchupLease,
        stream: Uuid,
    ) -> Result<(Option<bool>, bool), MailboxError> {
        let mut tx = self.0.begin().await.map_err(db_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '1s'")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        let result = sqlx::query!(
            r#"
            WITH owned AS MATERIALIZED (
                SELECT
                    id
                FROM
                    email_imap_host_catchup
                WHERE
                    id = 1
                    AND lease_id = $1
                    AND lease_until > clock_timestamp()
                FOR UPDATE
            ), candidate AS MATERIALIZED (
                SELECT
                    s.id,
                    (
                        l.is_sync_active
                        AND NOT l.needs_reauth
                        AND l.mailbox_unavailable_at IS NULL
                        AND s.generation = l.sync_generation
                        AND l.provider = 'IMAP'
                    ) AS eligible
                FROM
                    email_sync_streams s
                JOIN
                    email_links l ON l.id = s.link_id
                CROSS JOIN
                    owned
                WHERE
                    s.id = $2
                    AND s.provider = 'IMAP'
                    AND s.kind IN ('folder_catalog', 'mail_folder')
                FOR UPDATE OF s SKIP LOCKED
                FOR KEY SHARE OF l SKIP LOCKED
            ), updated AS (
                UPDATE
                    email_sync_streams s
                SET
                    notified_at = CASE
                        WHEN c.eligible THEN clock_timestamp()
                        ELSE s.notified_at
                    END,
                    notified_traceparent = CASE
                        WHEN c.eligible THEN $4
                        ELSE s.notified_traceparent
                    END,
                    notification_revision = CASE
                        WHEN c.eligible AND $3 THEN s.notification_revision + 1
                        ELSE s.notification_revision
                    END,
                    leased_notification_revision = CASE
                        WHEN NOT c.eligible AND (s.lease_id IS NULL OR s.lease_until < now())
                            THEN s.notification_revision
                        ELSE s.leased_notification_revision
                    END,
                    next_run_at = CASE
                        WHEN c.eligible THEN GREATEST(
                            LEAST(s.next_run_at, clock_timestamp()),
                            s.provider_retry_at
                        )
                        ELSE s.next_run_at
                    END
                FROM
                    candidate c
                WHERE
                    s.id = c.id
                    AND (
                        (c.eligible AND ($3 OR s.next_run_at > GREATEST(clock_timestamp(), s.provider_retry_at)))
                        OR (NOT c.eligible AND s.notification_revision > s.leased_notification_revision)
                    )
                RETURNING
                    c.eligible AS woken
            )
            SELECT
                (
                    SELECT
                        eligible
                    FROM
                        candidate
                ) AS woken,
                EXISTS (
                    SELECT
                        1
                    FROM
                        email_sync_streams
                    WHERE
                        id = $2
                ) AS "exists!"
            "#,
            lease.id,
            stream,
            lease.mode == CatchupMode::Startup,
            crate::trace_context::current(),
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok((result.woken, result.exists))
    }
}
