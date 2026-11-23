//! Provider-scoped due-work selection; provider IO starts after leases commit.

use super::*;
use tracing::Instrument;

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
    ) -> Result<SyncClaim<StreamLease>, MailboxError> {
        let mut tx = self.begin_claim().await?;
        let work = match kind {
            StreamKind::MailFolder => StreamWork::Folder,
            StreamKind::LivePass => StreamWork::Live,
        };
        let window = self.lock_stream_window(&mut tx, work).await?;
        if window.ids.is_empty() {
            tx.commit().await.map_err(db_error)?;
            return Ok(SyncClaim::Idle);
        }
        // Empty polls have no span; a nonempty maintained window is work
        // even when it does not produce a provider lease.
        let claim_span = tracing::info_span!(
            "email.mailbox.claim",
            mailbox.provider = self.provider.as_str(),
            mailbox.work = kind.as_str(),
            mailbox.window_rows =
                i64::try_from(window.ids.len()).map_err(|_| MailboxError::Persistence)?,
            mailbox.window_maintained = window.maintained,
            mailbox.link_id = tracing::field::Empty,
            mailbox.outcome = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let result: Result<SyncClaim<StreamLease>, MailboxError> = async {
            let row = sqlx::query_as!(
                ClaimedStream,
                r#"
            WITH keys AS MATERIALIZED (
                SELECT unnest($1::uuid[]) AS id
            ), candidate AS MATERIALIZED (
                SELECT s.id, s.notified_traceparent
                FROM keys k
                -- Preserve a bounded unique-key re-read even in generic plans.
                CROSS JOIN LATERAL (
                    SELECT s.id, s.notified_traceparent, s.kind, s.initial_complete,
                        s.next_run_at, s.provider_retry_at, s.lease_until
                    FROM email_sync_streams s JOIN email_links l ON l.id = s.link_id
                    WHERE s.id = k.id AND s.parked_at IS NULL
                    AND s.kind = $3
                    AND s.provider = $4::text::email_user_provider_enum
                    AND l.provider = s.provider AND l.sync_generation = s.generation
                    AND l.is_sync_active AND NOT l.needs_reauth
                    AND l.mailbox_unavailable_at IS NULL
                    AND GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz)) <= now()
                    LIMIT 1
                ) s
                ORDER BY GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz))
                    - CASE WHEN s.kind = 'mail_folder' AND NOT s.initial_complete
                        THEN make_interval(secs => $5) ELSE interval '0' END,
                    s.id
                LIMIT 1
            )
            UPDATE email_sync_streams s
            SET lease_id = $2, lease_until = now() + interval '3 minutes',
                lease_started_at = clock_timestamp(),
                leased_notification_revision = s.notification_revision,
                provider_retry_at = NULL, fence = s.fence + 1,
                notified_traceparent = NULL
            FROM candidate c, email_links l
            WHERE s.id = c.id AND l.id = s.link_id
            RETURNING s.id, s.link_id, s.generation, l.grant_generation,
                s.scope_id, s.position, s.initial_complete, s.fence,
                s.notified_at, c.notified_traceparent, s.import_started_at
            "#,
                &window.ids,
                lease_id,
                kind.as_str(),
                self.provider.as_str(),
                f64::from(IMPORT_ROUND_HEAD_START_SECONDS),
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            let Some(row) = row else {
                return Ok(if window.maintained > 0 {
                    SyncClaim::Progress
                } else {
                    SyncClaim::Idle
                });
            };
            let pass = match kind {
                StreamKind::MailFolder => FolderPass::Folder,
                StreamKind::LivePass => FolderPass::Live {
                    received_since: row.import_started_at.ok_or(MailboxError::Persistence)?,
                },
            };
            Ok(SyncClaim::Acquired(StreamLease {
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
            }))
        }
        .instrument(claim_span.clone())
        .await;
        let outcome = match &result {
            Ok(SyncClaim::Acquired(lease)) => {
                claim_span.record(
                    "mailbox.link_id",
                    tracing::field::display(lease.mailbox.link_id),
                );
                "acquired"
            }
            Ok(SyncClaim::Progress) => "progress",
            Ok(SyncClaim::Idle) => "idle",
            Err(_) => {
                claim_span.record("otel.status_code", "ERROR");
                "failed"
            }
        };
        claim_span.record("mailbox.outcome", outcome);
        result
    }

    pub(super) async fn lock_stream_window(
        &self,
        connection: &mut sqlx::PgConnection,
        work: StreamWork,
    ) -> Result<StreamWindow, MailboxError> {
        let (kind, imports) = match work {
            StreamWork::Catalog => ("folder_catalog", false),
            StreamWork::Folder => ("mail_folder", true),
            StreamWork::Live => ("mail_folder_live", false),
        };
        // Each index walk locks at most 32 rows when imports have priority,
        // otherwise the sole walk locks 64. Duplicates are removed afterward.
        sqlx::query_as!(
            StreamWindow,
            r#"
            WITH imports AS MATERIALIZED (
                SELECT s.id,
                    GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz))
                        - make_interval(secs => $5) AS claim_order
                FROM email_sync_streams s
                WHERE $3 AND s.provider = $1::text::email_user_provider_enum
                    AND s.kind = 'mail_folder' AND NOT s.initial_complete
                    AND s.parked_at IS NULL
                    AND GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz)) <= now()
                ORDER BY GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz)), s.id
                LIMIT 32 FOR UPDATE OF s SKIP LOCKED
            ), ordinary AS MATERIALIZED (
                SELECT s.id,
                    GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz))
                        - CASE WHEN $3 AND NOT s.initial_complete
                            THEN make_interval(secs => $5) ELSE interval '0' END AS claim_order
                FROM email_sync_streams s
                WHERE s.provider = $1::text::email_user_provider_enum
                    AND s.kind = $2 AND s.parked_at IS NULL
                    AND GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz)) <= now()
                ORDER BY GREATEST(s.next_run_at,
                        COALESCE(s.provider_retry_at, '-infinity'::timestamptz),
                        COALESCE(s.lease_until, '-infinity'::timestamptz)), s.id
                LIMIT $4 FOR UPDATE OF s SKIP LOCKED
            ), due AS MATERIALIZED (
                SELECT id, claim_order FROM imports
                UNION SELECT id, claim_order FROM ordinary
            ), inactive AS MATERIALIZED (
                SELECT DISTINCT ON (l.id) l.*
                FROM due d JOIN email_sync_streams s ON s.id = d.id
                CROSS JOIN LATERAL (
                    SELECT l.id, l.sync_generation, l.is_sync_active,
                        l.needs_reauth, l.mailbox_unavailable_at
                    FROM email_links l WHERE l.id = s.link_id AND (
                        NOT l.is_sync_active OR l.needs_reauth
                        OR ($2 <> 'folder_catalog' AND l.mailbox_unavailable_at IS NOT NULL)
                        OR l.sync_generation <> s.generation)
                    FOR SHARE OF l SKIP LOCKED
                ) l
                ORDER BY l.id
            ), maintained AS (
                UPDATE email_sync_streams s
                SET parked_at = now()
                FROM due d, email_links l LEFT JOIN inactive i ON i.id = l.id
                WHERE s.id = d.id AND l.id = s.link_id
                    AND (s.provider IS DISTINCT FROM l.provider OR (
                        i.id IS NOT NULL AND (
                        NOT i.is_sync_active OR i.needs_reauth
                        OR ($2 <> 'folder_catalog' AND i.mailbox_unavailable_at IS NOT NULL)
                        OR i.sync_generation <> s.generation)))
                RETURNING s.id
            )
            SELECT ARRAY(SELECT id FROM due ORDER BY claim_order,id) AS "ids!",
                (SELECT count(*) FROM maintained) AS "maintained!"
            "#,
            self.provider.as_str(),
            kind,
            imports,
            if imports { 32i64 } else { 64i64 },
            f64::from(IMPORT_ROUND_HEAD_START_SECONDS),
        )
        .fetch_one(connection)
        .await
        .map_err(db_error)
    }

    pub(super) async fn claim_message_lease(
        &self,
        lease_id: Uuid,
    ) -> Result<SyncClaim<MessageLease>, MailboxError> {
        let mut tx = self.begin_claim().await?;
        let window = self.lock_message_window(&mut tx).await?;
        if window.link_ids.is_empty() {
            tx.commit().await.map_err(db_error)?;
            return Ok(SyncClaim::Idle);
        }
        // The first statement holds these rows. Re-read their parent fences
        // after maintenance commits its own changes within this transaction.
        // Empty polls have no span; a nonempty maintained window is work
        // even when it does not produce a provider lease.
        let claim_span = tracing::info_span!(
            "email.mailbox.claim",
            mailbox.provider = self.provider.as_str(),
            mailbox.work = "reconciliation",
            mailbox.window_rows =
                i64::try_from(window.link_ids.len()).map_err(|_| MailboxError::Persistence)?,
            mailbox.window_maintained = window.maintained,
            mailbox.link_id = tracing::field::Empty,
            mailbox.outcome = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let result: Result<SyncClaim<MessageLease>, MailboxError> = async {
            let row = sqlx::query!(
                r#"
            WITH keys AS MATERIALIZED (
                SELECT * FROM unnest($1::uuid[], $2::bigint[], $3::text[])
                    AS k(link_id, generation, provider_id)
            ), candidate AS MATERIALIZED (
                SELECT q.link_id, q.generation, q.provider_id, q.notified_traceparent
                FROM keys k
                -- Keep one unique-key probe per locked row. Flattening this
                -- into a hash join can scan every due message under stale stats.
                CROSS JOIN LATERAL (
                    SELECT q.link_id, q.generation, q.provider_id, q.is_import,
                        q.available_at, q.lease_until, q.notified_traceparent
                    FROM email_message_reconciliation q
                    JOIN email_links l ON l.id = q.link_id
                    WHERE (q.link_id, q.generation, q.provider_id) =
                          (k.link_id, k.generation, k.provider_id)
                        AND q.parked_at IS NULL
                        AND q.provider = $5::text::email_user_provider_enum
                        AND l.provider = q.provider
                        AND q.generation = l.sync_generation
                        AND l.is_sync_active AND NOT l.needs_reauth
                        AND l.mailbox_unavailable_at IS NULL
                        AND GREATEST(q.available_at,
                            COALESCE(q.lease_until, '-infinity'::timestamptz)) <= now()
                    LIMIT 1
                ) q
                ORDER BY q.is_import,
                    GREATEST(q.available_at,
                        COALESCE(q.lease_until, '-infinity'::timestamptz)),
                    q.link_id, q.generation, q.provider_id
                LIMIT 1
            )
            UPDATE email_message_reconciliation q
            SET lease_id = $4, lease_until = now() + interval '3 minutes',
                attempts = q.attempts + 1,
                unfinished_claims = CASE
                    WHEN q.lease_id IS NULL OR q.revision <> q.claimed_revision THEN 0
                    ELSE q.unfinished_claims + 1 END,
                claimed_revision = q.revision, notified_traceparent = NULL
            FROM candidate c, email_links l
            WHERE (q.link_id, q.generation, q.provider_id) =
                  (c.link_id, c.generation, c.provider_id) AND l.id = q.link_id
            RETURNING q.link_id, q.generation, l.grant_generation,
                q.provider_id, q.revision, q.is_import, q.attempts,
                q.unfinished_claims, q.notified_at, c.notified_traceparent,
                q.from_notification
            "#,
                &window.link_ids,
                &window.generations,
                &window.provider_ids,
                lease_id,
                self.provider.as_str(),
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            let Some(row) = row else {
                return Ok(if window.maintained > 0 {
                    SyncClaim::Progress
                } else {
                    SyncClaim::Idle
                });
            };
            Ok(SyncClaim::Acquired(MessageLease {
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
            }))
        }
        .instrument(claim_span.clone())
        .await;
        let outcome = match &result {
            Ok(SyncClaim::Acquired(lease)) => {
                claim_span.record(
                    "mailbox.link_id",
                    tracing::field::display(lease.mailbox.link_id),
                );
                "acquired"
            }
            Ok(SyncClaim::Progress) => "progress",
            Ok(SyncClaim::Idle) => "idle",
            Err(_) => {
                claim_span.record("otel.status_code", "ERROR");
                "failed"
            }
        };
        claim_span.record("mailbox.outcome", outcome);
        result
    }

    /// A bounded index walk, followed only by parent probes for its candidates.
    /// Relabel a legacy row in place so its real provider can claim it next.
    async fn lock_message_window(
        &self,
        connection: &mut sqlx::PgConnection,
    ) -> Result<MessageWindow, MailboxError> {
        sqlx::query_as!(
            MessageWindow,
            r#"
            WITH due AS MATERIALIZED (
                -- A serial Append fills the live branch first. The outer
                -- LIMIT stops before locking more than 64 rows across both.
                SELECT * FROM (
                    SELECT * FROM (
                     SELECT q.link_id, q.generation, q.provider_id
                     FROM email_message_reconciliation q
                     WHERE q.provider = $1::text::email_user_provider_enum
                         AND NOT q.is_import AND q.parked_at IS NULL
                         AND GREATEST(q.available_at,
                             COALESCE(q.lease_until, '-infinity'::timestamptz)) <= now()
                     ORDER BY GREATEST(q.available_at,
                             COALESCE(q.lease_until, '-infinity'::timestamptz)),
                         q.link_id, q.generation, q.provider_id
                     LIMIT 64 FOR UPDATE OF q SKIP LOCKED
                    ) live_rows
                    UNION ALL
                    SELECT * FROM (
                     SELECT q.link_id, q.generation, q.provider_id
                     FROM email_message_reconciliation q
                     WHERE $2 AND q.provider = $1::text::email_user_provider_enum
                         AND q.is_import AND q.parked_at IS NULL
                         AND GREATEST(q.available_at,
                             COALESCE(q.lease_until, '-infinity'::timestamptz)) <= now()
                     ORDER BY GREATEST(q.available_at,
                             COALESCE(q.lease_until, '-infinity'::timestamptz)),
                         q.link_id, q.generation, q.provider_id
                     LIMIT 64 FOR UPDATE OF q SKIP LOCKED
                    ) import_rows
                ) ordered_work
                LIMIT 64
            ), inactive AS MATERIALIZED (
                SELECT DISTINCT ON (l.id) l.*
                FROM due d
                CROSS JOIN LATERAL (
                    SELECT l.id, l.sync_generation, l.is_sync_active,
                        l.needs_reauth, l.mailbox_unavailable_at
                    FROM email_links l
                    WHERE l.id = d.link_id AND (
                        NOT l.is_sync_active OR l.needs_reauth
                        OR l.mailbox_unavailable_at IS NOT NULL
                        OR l.sync_generation <> d.generation)
                    FOR SHARE OF l SKIP LOCKED
                ) l
                ORDER BY l.id
            ), maintained AS (
                UPDATE email_message_reconciliation q
                SET provider = l.provider,
                    parked_at = CASE WHEN i.id IS NOT NULL AND (
                        NOT i.is_sync_active OR i.needs_reauth
                        OR i.mailbox_unavailable_at IS NOT NULL
                        OR i.sync_generation <> q.generation)
                        THEN now() ELSE q.parked_at END
                FROM due d JOIN email_links l ON l.id = d.link_id
                LEFT JOIN inactive i ON i.id = l.id
                WHERE (q.link_id, q.generation, q.provider_id) =
                      (d.link_id, d.generation, d.provider_id)
                    AND (q.provider IS DISTINCT FROM l.provider OR (
                        i.id IS NOT NULL AND (NOT i.is_sync_active OR i.needs_reauth
                        OR i.mailbox_unavailable_at IS NOT NULL
                        OR i.sync_generation <> q.generation)))
                RETURNING q.link_id
            )
            SELECT
                ARRAY(SELECT link_id FROM due ORDER BY link_id,generation,provider_id)
                    AS "link_ids!",
                ARRAY(SELECT generation FROM due ORDER BY link_id,generation,provider_id)
                    AS "generations!",
                ARRAY(SELECT provider_id FROM due ORDER BY link_id,generation,provider_id)
                    AS "provider_ids!",
                (SELECT count(*) FROM maintained) AS "maintained!"
            "#,
            self.provider.as_str(),
            !self.imports_paused,
        )
        .fetch_one(connection)
        .await
        .map_err(db_error)
    }
}

struct MessageWindow {
    link_ids: Vec<Uuid>,
    generations: Vec<i64>,
    provider_ids: Vec<String>,
    maintained: i64,
}

pub(super) enum StreamWork {
    Catalog,
    Folder,
    Live,
}

pub(super) struct StreamWindow {
    pub(super) ids: Vec<Uuid>,
    pub(super) maintained: i64,
}
