//! Provider-scoped due-work selection; provider IO starts after leases commit.

use super::*;

/// How far ahead of finished folders' polls a mail folder's import round is
/// claimed. Polls of every finished folder of every mailbox share the sync
/// workers, so they run minutes late; an import round that waited behind them
/// would read a page only every few minutes and leave its import idle. Import
/// rounds read at most a page per hundred imported messages (`pace_import`),
/// so going first costs the polls little, and a poll due longer than this
/// still goes ahead of every round that came due after it.
const IMPORT_ROUND_HEAD_START_SECONDS: u32 = 300;

/// The stream row a claim returns, from either kind's claim.
struct ClaimedStream {
    id: Uuid,
    link_id: Uuid,
    generation: i64,
    grant_generation: i64,
    scope_id: String,
    position: Option<String>,
    initial_complete: bool,
    fence: i64,
    notified_at: Option<chrono::DateTime<chrono::Utc>>,
    notified_traceparent: Option<String>,
    import_started_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl PgMailboxSync {
    pub(super) async fn claim_stream_lease(
        &self,
        lease_id: Uuid,
        kind: StreamKind,
    ) -> Result<Option<StreamLease>, MailboxError> {
        let mut tx = self.begin_claim().await?;
        let row = match kind {
            // The longest-due import round goes ahead as if it had come due
            // IMPORT_ROUND_HEAD_START_SECONDS earlier, so the next page of an
            // import is read as soon as its mailbox has room instead of behind
            // every finished folder's poll. A poll due longer than that comes
            // first again. Each candidate is one row off its own index.
            // The floor skips old work for ineligible links. The first raw
            // index head avoids per-link probes in the healthy case; otherwise
            // read-only per-link heads locate the earliest eligible due row.
            // Locking stays in the global ordered scan so a locked head cannot
            // hide another eligible stream of the same mailbox.
            StreamKind::MailFolder => {
                sqlx::query_as!(
                    ClaimedStream,
                    r#"
                    WITH import_round AS (
                        SELECT
                            s.id,
                            s.notified_traceparent,
                            s.next_run_at - make_interval(secs => $2) AS claim_order
                        FROM
                            email_sync_streams s
                            JOIN email_links l ON l.id = s.link_id
                        WHERE
                            l.is_sync_active
                            AND NOT l.needs_reauth
                            AND l.mailbox_unavailable_at IS NULL
                            AND l.provider = $3::text::email_user_provider_enum
                            AND s.provider = $3::text::email_user_provider_enum
                            AND s.generation = l.sync_generation
                            AND s.kind = 'mail_folder'
                            AND NOT s.initial_complete
                            AND s.next_run_at <= now()
                            AND (s.provider_retry_at IS NULL OR s.provider_retry_at <= now())
                            AND (s.next_run_at,
                                s.id) >= (
                                SELECT
                                    COALESCE(h.due, raw.due),
                                    COALESCE(h.id, raw.id)
                                FROM (
                                    SELECT
                                        r.next_run_at AS due,
                                        r.id,
                                        r.link_id,
                                        r.generation,
                                        r.lease_until
                                    FROM
                                        email_sync_streams r
                                    WHERE
                                        r.provider = $3::text::email_user_provider_enum
                                        AND r.kind = 'mail_folder'
                                        AND NOT r.initial_complete
                                        AND r.next_run_at <= now()
                                        AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                    ORDER BY
                                        r.next_run_at,
                                        r.id
                                    LIMIT 1) raw
                            LEFT JOIN email_links ok ON ok.id = raw.link_id
                                AND ok.sync_generation = raw.generation
                                AND ok.provider = $3::text::email_user_provider_enum
                                AND ok.is_sync_active
                                AND NOT ok.needs_reauth
                                AND ok.mailbox_unavailable_at IS NULL
                                AND (raw.lease_until IS NULL
                                    OR raw.lease_until < now())
                            LEFT JOIN LATERAL (
                                SELECT
                                    first.due,
                                    first.id
                                FROM
                                    email_links l
                                    CROSS JOIN LATERAL (
                                        SELECT
                                            scoped.due,
                                            scoped.id
                                        FROM (
                                            SELECT
                                                r.next_run_at AS due,
                                                r.id
                                            FROM
                                                email_sync_streams r
                                            WHERE
                                                r.link_id = l.id
                                                AND r.generation = l.sync_generation
                                                AND r.kind = 'mail_folder'
                                                AND NOT r.initial_complete
                                                AND r.next_run_at <= now()
                                                AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                                AND (r.lease_until IS NULL
                                                    OR r.lease_until < now())
                                                OFFSET 0) scoped
                                        ORDER BY
                                            scoped.due,
                                            scoped.id
                                        LIMIT 1)
                                    first
                                WHERE
                                    ok.id IS NULL
                                    AND l.provider = $3::text::email_user_provider_enum
                                    AND l.is_sync_active
                                    AND NOT l.needs_reauth
                                    AND l.mailbox_unavailable_at IS NULL
                                ORDER BY
                                    first.due,
                                    first.id
                                LIMIT 1) h ON true
                        WHERE
                            ok.id IS NOT NULL
                            OR h.id IS NOT NULL)
                        AND (s.lease_until IS NULL
                            OR s.lease_until < now())
                    ORDER BY
                        s.next_run_at,
                        s.id
                    LIMIT 1
                    FOR UPDATE
                        OF s SKIP LOCKED
                    ),
                    longest_due AS (
                        SELECT
                            s.id,
                            s.notified_traceparent,
                            s.next_run_at AS claim_order
                        FROM
                            email_sync_streams s
                            JOIN email_links l ON l.id = s.link_id
                        WHERE
                            l.is_sync_active
                            AND NOT l.needs_reauth
                            AND l.mailbox_unavailable_at IS NULL
                            AND l.provider = $3::text::email_user_provider_enum
                            AND s.provider = $3::text::email_user_provider_enum
                            AND s.generation = l.sync_generation
                            AND s.kind = 'mail_folder'
                            AND s.next_run_at <= now()
                            AND (s.provider_retry_at IS NULL OR s.provider_retry_at <= now())
                            AND (s.next_run_at,
                                s.id) >= (
                                SELECT
                                    COALESCE(h.due, raw.due),
                                    COALESCE(h.id, raw.id)
                                FROM (
                                    SELECT
                                        r.next_run_at AS due,
                                        r.id,
                                        r.link_id,
                                        r.generation,
                                        r.lease_until
                                    FROM
                                        email_sync_streams r
                                    WHERE
                                        r.provider = $3::text::email_user_provider_enum
                                        AND r.kind = 'mail_folder'
                                        AND r.next_run_at <= now()
                                        AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                    ORDER BY
                                        r.next_run_at,
                                        r.id
                                    LIMIT 1) raw
                            LEFT JOIN email_links ok ON ok.id = raw.link_id
                                AND ok.sync_generation = raw.generation
                                AND ok.provider = $3::text::email_user_provider_enum
                                AND ok.is_sync_active
                                AND NOT ok.needs_reauth
                                AND ok.mailbox_unavailable_at IS NULL
                                AND (raw.lease_until IS NULL
                                    OR raw.lease_until < now())
                            LEFT JOIN LATERAL (
                                SELECT
                                    first.due,
                                    first.id
                                FROM
                                    email_links l
                                    CROSS JOIN LATERAL (
                                        SELECT
                                            scoped.due,
                                            scoped.id
                                        FROM (
                                            SELECT
                                                r.next_run_at AS due,
                                                r.id
                                            FROM
                                                email_sync_streams r
                                            WHERE
                                                r.link_id = l.id
                                                AND r.generation = l.sync_generation
                                                AND r.kind = 'mail_folder'
                                                AND r.next_run_at <= now()
                                                AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                                AND (r.lease_until IS NULL
                                                    OR r.lease_until < now())
                                                OFFSET 0) scoped
                                        ORDER BY
                                            scoped.due,
                                            scoped.id
                                        LIMIT 1)
                                    first
                                WHERE
                                    ok.id IS NULL
                                    AND l.provider = $3::text::email_user_provider_enum
                                    AND l.is_sync_active
                                    AND NOT l.needs_reauth
                                    AND l.mailbox_unavailable_at IS NULL
                                ORDER BY
                                    first.due,
                                    first.id
                                LIMIT 1) h ON true
                        WHERE
                            ok.id IS NOT NULL
                            OR h.id IS NOT NULL)
                        AND (s.lease_until IS NULL
                            OR s.lease_until < now())
                    ORDER BY
                        s.next_run_at,
                        s.id
                    LIMIT 1
                    FOR UPDATE
                        OF s SKIP LOCKED
                    ),
                    candidate AS (
                        SELECT
                            c.id,
                            c.notified_traceparent
                        FROM (
                            SELECT
                                *
                            FROM
                                import_round
                            UNION ALL
                            SELECT
                                *
                            FROM
                                longest_due) c
                        ORDER BY
                            c.claim_order,
                            c.id
                        LIMIT 1)
                    -- The trace context is handed over once: retries get traces of
                    -- their own, so a long deferral can't grow the webhook's trace.
                    UPDATE
                        email_sync_streams s
                    SET
                        lease_id = $1,
                        lease_until = now() + interval '3 minutes',
                    lease_started_at = clock_timestamp(),
                    leased_notification_revision = s.notification_revision,
                    provider_retry_at = NULL,
                    fence = fence + 1,
                    notified_traceparent = NULL
                    FROM
                        candidate c,
                        email_links l
                    WHERE
                        s.id = c.id
                        AND l.id = s.link_id
                    RETURNING
                        s.id,
                        s.link_id,
                        s.generation,
                        l.grant_generation,
                        s.scope_id,
                        s.position,
                        s.initial_complete,
                        s.fence,
                        s.notified_at,
                        c.notified_traceparent,
                        s.import_started_at
                    "#,
                    lease_id,
                    f64::from(IMPORT_ROUND_HEAD_START_SECONDS),
                    self.provider.as_str(),
                )
                .fetch_optional(&mut *tx)
                .await
            }
            StreamKind::LivePass => {
                sqlx::query_as!(
                    ClaimedStream,
                    r#"
                    WITH candidate AS (
                        SELECT
                            s.id,
                            s.notified_traceparent
                        FROM
                            email_sync_streams s
                            JOIN email_links l ON l.id = s.link_id
                        WHERE
                            l.is_sync_active
                            AND NOT l.needs_reauth
                            AND l.mailbox_unavailable_at IS NULL
                            AND l.provider = $3::text::email_user_provider_enum
                            AND s.provider = $3::text::email_user_provider_enum
                            AND s.generation = l.sync_generation
                            AND s.kind = $2
                            AND s.next_run_at <= now()
                            AND (s.provider_retry_at IS NULL OR s.provider_retry_at <= now())
                            AND (s.next_run_at,
                                s.id) >= (
                                SELECT
                                    COALESCE(h.due, raw.due),
                                    COALESCE(h.id, raw.id)
                                FROM (
                                    SELECT
                                        r.next_run_at AS due,
                                        r.id,
                                        r.link_id,
                                        r.generation,
                                        r.lease_until
                                    FROM
                                        email_sync_streams r
                                    WHERE
                                        r.provider = $3::text::email_user_provider_enum
                                        AND r.kind = $2
                                        AND r.next_run_at <= now()
                                        AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                    ORDER BY
                                        r.next_run_at,
                                        r.id
                                    LIMIT 1) raw
                            LEFT JOIN email_links ok ON ok.id = raw.link_id
                                AND ok.sync_generation = raw.generation
                                AND ok.provider = $3::text::email_user_provider_enum
                                AND ok.is_sync_active
                                AND NOT ok.needs_reauth
                                AND ok.mailbox_unavailable_at IS NULL
                                AND (raw.lease_until IS NULL
                                    OR raw.lease_until < now())
                            LEFT JOIN LATERAL (
                                SELECT
                                    first.due,
                                    first.id
                                FROM
                                    email_links l
                                    CROSS JOIN LATERAL (
                                        SELECT
                                            scoped.due,
                                            scoped.id
                                        FROM (
                                            SELECT
                                                r.next_run_at AS due,
                                                r.id
                                            FROM
                                                email_sync_streams r
                                            WHERE
                                                r.link_id = l.id
                                                AND r.generation = l.sync_generation
                                                AND r.kind = $2
                                                AND r.next_run_at <= now()
                                                AND (r.provider_retry_at IS NULL OR r.provider_retry_at <= now())
                                                AND (r.lease_until IS NULL
                                                    OR r.lease_until < now())
                                                OFFSET 0) scoped
                                        ORDER BY
                                            scoped.due,
                                            scoped.id
                                        LIMIT 1)
                                    first
                                WHERE
                                    ok.id IS NULL
                                    AND l.provider = $3::text::email_user_provider_enum
                                    AND l.is_sync_active
                                    AND NOT l.needs_reauth
                                    AND l.mailbox_unavailable_at IS NULL
                                ORDER BY
                                    first.due,
                                    first.id
                                LIMIT 1) h ON true
                        WHERE
                            ok.id IS NOT NULL
                            OR h.id IS NOT NULL)
                        AND (s.lease_until IS NULL
                            OR s.lease_until < now())
                    ORDER BY
                        s.next_run_at,
                        s.id
                    LIMIT 1
                    FOR UPDATE
                        OF s SKIP LOCKED)
                    -- The trace context is handed over once: retries get traces of
                    -- their own, so a long deferral can't grow the webhook's trace.
                    UPDATE
                        email_sync_streams s
                    SET
                        lease_id = $1,
                        lease_until = now() + interval '3 minutes',
                    lease_started_at = clock_timestamp(),
                    leased_notification_revision = s.notification_revision,
                    provider_retry_at = NULL,
                    fence = fence + 1,
                    notified_traceparent = NULL
                    FROM
                        candidate c,
                        email_links l
                    WHERE
                        s.id = c.id
                        AND l.id = s.link_id
                    RETURNING
                        s.id,
                        s.link_id,
                        s.generation,
                        l.grant_generation,
                        s.scope_id,
                        s.position,
                        s.initial_complete,
                        s.fence,
                        s.notified_at,
                        c.notified_traceparent,
                        s.import_started_at
                    "#,
                    lease_id,
                    kind.as_str(),
                    self.provider.as_str(),
                )
                .fetch_optional(&mut *tx)
                .await
            }
        }
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        row.map(|row| {
            let pass = match kind {
                StreamKind::MailFolder => FolderPass::Folder,
                StreamKind::LivePass => FolderPass::Live {
                    received_since: row.import_started_at.ok_or(MailboxError::Persistence)?,
                },
            };
            Ok(StreamLease {
                id: row.id,
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.generation,
                    grant_generation: row.grant_generation,
                },
                folder: ProviderId::new(row.scope_id)?,
                pass,
                position: row.position.map(StreamToken::new),
                initial_complete: row.initial_complete,
                lease_id,
                fence: row.fence,
                notification: notification(row.notified_at, row.notified_traceparent),
            })
        })
        .transpose()
    }

    pub(super) async fn claim_message_lease(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<MessageLease>, MailboxError> {
        // Naming both `is_import` values lets `available_at <= now()` end the claim index scan.
        // Without it, Postgres before 18 reads every backed-off row on each poll.
        // Paused imports name `false` twice, so only live rows are claimed.
        // The equivalent boolean upper bound also narrows PG14 generic plans.
        // A conservative eligible floor bypasses inactive/stale queue prefixes;
        // provider_id remains in the final lock order to retain exact ties.
        let mut tx = self.begin_claim().await?;
        let row = sqlx::query!(
            r#"
            WITH eligible AS MATERIALIZED (
                SELECT
                    1
                FROM
                    email_links
                WHERE
                    provider = $3::text::email_user_provider_enum
                    AND is_sync_active
                    AND NOT needs_reauth
                    AND mailbox_unavailable_at IS NULL
                LIMIT 1
            ),
            candidate AS (
                SELECT
                    q.link_id,
                    q.generation,
                    q.provider_id,
                    q.notified_traceparent
                FROM
                    email_message_reconciliation q
                    JOIN email_links l ON l.id = q.link_id
                WHERE
                    EXISTS (
                        SELECT
                            1
                        FROM
                            eligible)
                    AND q.generation = l.sync_generation
                    AND l.is_sync_active
                    AND NOT l.needs_reauth
                    AND l.mailbox_unavailable_at IS NULL
                    AND l.provider = $3::text::email_user_provider_enum
                    AND q.provider = $3::text::email_user_provider_enum
                    AND q.is_import IN (false, $2)
                    AND q.is_import <= $2
                    AND (q.is_import,
                        q.available_at,
                        q.link_id) >= (
                        SELECT
                            COALESCE(h.is_import, raw.is_import),
                            COALESCE(h.available_at, raw.available_at),
                            COALESCE(h.link_id, raw.link_id)
                        FROM (
                            SELECT
                                r.is_import,
                                r.available_at,
                                r.link_id,
                                r.generation,
                                r.lease_until
                            FROM
                                email_message_reconciliation r
                            WHERE
                                r.provider = $3::text::email_user_provider_enum
                                AND r.is_import IN (false, $2)
                                AND r.is_import <= $2
                                AND r.available_at <= now()
                            ORDER BY
                                r.is_import,
                                r.available_at,
                                r.link_id,
                                r.provider_id
                            LIMIT 1) raw
                    LEFT JOIN email_links ok ON ok.id = raw.link_id
                        AND ok.sync_generation = raw.generation
                        AND ok.provider = $3::text::email_user_provider_enum
                        AND ok.is_sync_active
                        AND NOT ok.needs_reauth
                        AND ok.mailbox_unavailable_at IS NULL
                        AND (raw.lease_until IS NULL
                            OR raw.lease_until < now())
                    LEFT JOIN LATERAL (
                        SELECT
                            head.is_import,
                            head.available_at,
                            l.id AS link_id
                        FROM
                            email_links l
                            CROSS JOIN LATERAL ((
                                    SELECT
                                        false AS is_import,
                                        r.available_at
                                    FROM
                                        email_message_reconciliation r
                                    WHERE
                                        r.link_id = l.id
                                        AND r.generation = l.sync_generation
                                        AND NOT r.is_import
                                        AND r.available_at <> 'infinity'
                                        AND r.available_at <= now()
                                        AND (r.lease_until IS NULL
                                            OR r.lease_until < now())
                                    ORDER BY
                                        r.available_at
                                    LIMIT 1)
                            UNION ALL (
                                SELECT
                                    true AS is_import,
                                    r.available_at
                                FROM
                                    email_message_reconciliation r
                                WHERE
                                    r.link_id = l.id
                                    AND r.generation = l.sync_generation
                                    AND $2
                                    AND r.is_import
                                    AND r.available_at <> 'infinity'
                                    AND r.available_at <= now()
                                    AND (r.lease_until IS NULL
                                        OR r.lease_until < now())
                                ORDER BY
                                    r.available_at
                                LIMIT 1)
                        ORDER BY
                            is_import,
                            available_at
                        LIMIT 1) head
                WHERE
                    ok.id IS NULL
                    AND l.provider = $3::text::email_user_provider_enum
                    AND l.is_sync_active
                    AND NOT l.needs_reauth
                    AND l.mailbox_unavailable_at IS NULL
                ORDER BY
                    head.is_import,
                    head.available_at,
                    l.id
                LIMIT 1) h ON true
            WHERE
                ok.id IS NOT NULL
                OR h.link_id IS NOT NULL)
            AND q.available_at <= now()
            AND (q.lease_until IS NULL
                OR q.lease_until < now())
            ORDER BY
                q.is_import,
                q.available_at,
                q.link_id,
                q.provider_id
            LIMIT 1
            FOR UPDATE
                OF q SKIP LOCKED)
            -- Only the first attempt joins the notification's trace. Every
            -- recorded outcome deletes the row or clears its lease, so a lease
            -- still set here expired under a worker that stopped; a revision
            -- newer than the last claim read starts the count over.
            UPDATE
                email_message_reconciliation q
            SET
                lease_id = $1,
                lease_until = now() + interval '3 minutes',
            attempts = attempts + 1,
            unfinished_claims = CASE WHEN q.lease_id IS NULL
                OR q.revision <> q.claimed_revision THEN
                0
            ELSE
                q.unfinished_claims + 1
            END,
            claimed_revision = q.revision,
            notified_traceparent = NULL
            FROM
                candidate c,
                email_links l
            WHERE
                q.link_id = c.link_id
                AND q.generation = c.generation
                AND q.provider_id = c.provider_id
                AND l.id = q.link_id
            RETURNING
                q.link_id,
                q.generation,
                l.grant_generation,
                q.provider_id,
                q.revision,
                q.is_import,
                q.attempts,
                q.unfinished_claims,
                q.notified_at,
                c.notified_traceparent,
                q.from_notification
            "#,
            lease_id,
            !self.imports_paused,
            self.provider.as_str(),
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        row.map(|row| {
            Ok(MessageLease {
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.generation,
                    grant_generation: row.grant_generation,
                },
                provider_id: ProviderId::new(row.provider_id)?,
                revision: row.revision,
                lease_id,
                is_import: row.is_import,
                attempts: row.attempts,
                unfinished_claims: row.unfinished_claims,
                notification: notification(row.notified_at, row.notified_traceparent),
                from_notification: row.from_notification,
            })
        })
        .transpose()
    }
}
