//! Postgres implementation of durable mailbox stream and reconciliation leases.

use crate::domain::mailbox::live_pass::{FolderPass, StreamKind};
use crate::domain::mailbox::progress::ImportCompleted;
use crate::domain::mailbox::*;
use email_api_client::domain::models::{
    MailFolder, MailboxChangePage, ProviderId, StreamPosition, StreamToken,
};
use sqlx::PgPool;
use uuid::Uuid;

mod catalog;
mod claims;
mod commands;
mod contacts;
mod credentials;
mod drafts;
mod gmail_history;
mod imap_notifications;
mod ingest;
mod leases;
mod lifecycle;
mod mutation_claims;
pub mod parked_work_recovery;
mod progress;
mod projection;
mod purge;
mod reimport;
mod settings;
#[cfg(test)]
mod test;
mod watches;

#[derive(Clone)]
pub struct PgMailboxSync {
    pub(super) db: PgPool,
    imports_paused: bool,
    provider: crate::domain::models::UserProvider,
}

impl PgMailboxSync {
    pub fn new(db: PgPool) -> Self {
        Self {
            db,
            imports_paused: false,
            provider: crate::domain::models::UserProvider::Outlook,
        }
    }

    /// Bind every claim to one provider so workers never send another provider's work to this gateway.
    pub fn with_provider(mut self, provider: crate::domain::models::UserProvider) -> Self {
        self.provider = provider;
        self
    }

    /// While paused, message claims take only live work: import rows wait,
    /// and every live change keeps importing.
    pub fn with_imports_paused(mut self, paused: bool) -> Self {
        self.imports_paused = paused;
        self
    }

    /// Every mailbox transaction gives up on a lock it cannot get within 5 s
    /// (SQLSTATE 55P03), so a write queued behind a long lock holder, such as a
    /// CRM population share-locking its link, goes back to its caller's retry
    /// instead of holding a pooled connection.
    async fn begin(&self) -> Result<sqlx::Transaction<'_, sqlx::Postgres>, sqlx::Error> {
        let mut tx = self.db.begin().await?;
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        Ok(tx)
    }

    /// Polls have no provider IO and must release their connection promptly
    /// even when many due rows are temporarily ineligible.
    async fn begin_claim(&self) -> Result<sqlx::Transaction<'_, sqlx::Postgres>, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '15s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Ok(tx)
    }

    // Serialize only the brief lease-acquisition transactions. Draft and
    // organization workers must atomically observe each other's active leases;
    // no provider IO runs while this lock is held.
    async fn mutation_claim_transaction(
        &self,
    ) -> Result<sqlx::Transaction<'_, sqlx::Postgres>, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        sqlx::query!(
            r#"
            SET LOCAL statement_timeout = '15s'
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        // The rollback binary knows only this key. Take it first, for Outlook
        // alone, until that baseline is retired (mac-imap-smtp.89).
        if self.provider == crate::domain::models::UserProvider::Outlook {
            sqlx::query!("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.outlook.mutation-claims',0))")
                .fetch_one(&mut *tx).await.map_err(db_error)?;
        }
        sqlx::query!("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.mailbox.mutation-claims:' || $1::text,0))", self.provider.as_str())
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        Ok(tx)
    }
}

pub(super) fn db_error(error: sqlx::Error) -> MailboxError {
    MailboxError::database(DatabaseFailure::from(&error))
}

/// For `email_db_client` calls, which wrap their `sqlx` errors in `anyhow`.
fn wrapped_db_error(error: anyhow::Error) -> MailboxError {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<sqlx::Error>())
        .map_or(MailboxError::Persistence, |error| {
            MailboxError::database(DatabaseFailure::from(error))
        })
}

/// Lets any adapter keep a database error's SQLSTATE without its message.
impl From<&sqlx::Error> for DatabaseFailure {
    fn from(error: &sqlx::Error) -> Self {
        match error {
            sqlx::Error::Database(error) => error.code().map_or(DatabaseFailure::Other, |code| {
                DatabaseFailure::Sqlstate(code.into_owned())
            }),
            sqlx::Error::PoolTimedOut => DatabaseFailure::PoolTimedOut,
            sqlx::Error::Io(_)
            | sqlx::Error::Tls(_)
            | sqlx::Error::Protocol(_)
            | sqlx::Error::PoolClosed
            | sqlx::Error::WorkerCrashed => DatabaseFailure::Connection,
            sqlx::Error::ColumnDecode { .. }
            | sqlx::Error::Decode(_)
            | sqlx::Error::ColumnNotFound(_)
            | sqlx::Error::TypeNotFound { .. } => DatabaseFailure::Decode,
            _ => DatabaseFailure::Other,
        }
    }
}

impl MailboxSyncRepository for PgMailboxSync {
    async fn renew(&self, lease: SyncLease<'_>) -> Result<(), MailboxError> {
        let valid = match lease {
            SyncLease::Catalog(lease) => {
                self.renew_stream(lease.id, lease.lease_id, lease.fence, lease.mailbox)
                    .await?
            }
            SyncLease::Stream(lease) => {
                self.renew_stream(lease.id, lease.lease_id, lease.fence, lease.mailbox)
                    .await?
            }
            SyncLease::Message(lease) => self.renew_message(lease).await?,
        };
        if valid != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn claim_catalog(&self, lease_id: Uuid) -> Result<SyncClaim<CatalogLease>, MailboxError> {
        self.claim_catalog_lease(lease_id).await
    }
    async fn commit_catalog(
        &self,
        lease: &CatalogLease,
        folders: &[MailFolder],
    ) -> Result<Option<ImportCompleted>, MailboxError> {
        self.commit_catalog_lease(lease, folders).await
    }
    async fn release_catalog(
        &self,
        lease: &CatalogLease,
        retry: SyncRetry,
    ) -> Result<(), MailboxError> {
        self.release_catalog_lease(lease, retry).await
    }
    async fn mark_no_mailbox(&self, lease: &CatalogLease) -> Result<u32, MailboxError> {
        self.mark_catalog_without_mailbox(lease).await
    }
    // Sync claims skip a link flagged `needs_reauth`: its token requests can
    // only fail until a reconnect, or a token that works again, clears the flag.
    async fn claim_stream(
        &self,
        lease_id: Uuid,
        kind: StreamKind,
    ) -> Result<SyncClaim<StreamLease>, MailboxError> {
        self.claim_stream_lease(lease_id, kind).await
    }

    async fn commit_page(
        &self,
        lease: &StreamLease,
        page: &MailboxChangePage,
    ) -> Result<CommittedPage, MailboxError> {
        let (position, complete) = match &page.position {
            StreamPosition::Continue(position) => (position, false),
            StreamPosition::Checkpoint(position) => (position, true),
        };
        let mut ids: Vec<String> = page
            .changed
            .iter()
            .chain(&page.removed)
            .map(|id| id.as_str().to_owned())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        let mut tx = self.begin().await.map_err(db_error)?;
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        let advanced = sqlx::query!(
            r#"
            UPDATE
                email_sync_streams s
            SET
                position = $4,
                initial_complete = s.initial_complete OR $5,
                -- A round's first page records the reader revision it started at,
                -- and when: the claim that read it.
                reader_revision = CASE WHEN s.position IS NULL THEN $7 ELSE s.reader_revision END,
                round_started_at = CASE WHEN s.position IS NULL THEN s.lease_started_at ELSE s.round_started_at END,
                last_completed_at = CASE WHEN $5 THEN now() ELSE last_completed_at END,
                next_run_at = CASE
                    WHEN s.provider = 'IMAP' THEN CASE
                        WHEN $5 AND s.notification_revision <= s.leased_notification_revision
                            THEN now() + interval '2 minutes'
                        ELSE now()
                    END
                    WHEN $5 AND (s.notified_at IS NULL OR s.notified_at <= s.lease_started_at)
                        THEN now() + interval '2 minutes'
                    ELSE now()
                END,
                -- A checkpoint that started reading after the notification has
                -- answered it; a deferred or partial read leaves it pending.
                notified_at = CASE
                    WHEN s.provider = 'IMAP' THEN CASE
                        WHEN $5 AND s.notification_revision <= s.leased_notification_revision THEN NULL
                        ELSE s.notified_at
                    END
                    WHEN $5 AND s.notified_at <= s.lease_started_at THEN NULL
                    ELSE s.notified_at
                END,
                lease_id = NULL, lease_until = NULL
            FROM
                email_links l
            WHERE
                s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND s.link_id = l.id AND s.generation = l.sync_generation
                AND l.is_sync_active AND l.grant_generation = $6
        "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            position.expose(),
            complete,
            lease.mailbox.grant_generation,
            page.reader_revision,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if advanced.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        // The round's checkpoint lists everything its live pass was there
        // for, and the folder's later rounds read new mail themselves.
        if complete && !lease.initial_complete && lease.pass == FolderPass::Folder {
            Self::retire_live_pass(&mut tx, lease).await?;
        }
        let queued = sqlx::query!(
            r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,notified_at,notified_traceparent)
            SELECT $1,$2,provider_id,$4,$5,$6 FROM unnest($3::text[]) provider_id
            ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET
                revision = email_message_reconciliation.revision + 1,
                is_import = email_message_reconciliation.is_import AND EXCLUDED.is_import,
                -- A folder page lists the message, so it is read as a folder
                -- page's message, wherever it has moved since.
                from_notification = false,
                notified_at = COALESCE(EXCLUDED.notified_at, email_message_reconciliation.notified_at),
                notified_traceparent = CASE WHEN EXCLUDED.notified_at IS NULL
                    THEN email_message_reconciliation.notified_traceparent ELSE EXCLUDED.notified_traceparent END,
                available_at = now()
        "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            &ids,
            !lease.initial_complete,
            lease.notification.as_ref().map(|notification| notification.received_at),
            lease
                .notification
                .as_ref()
                .and_then(|notification| notification.traceparent.as_deref())
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?
        .rows_affected();
        let import_completed = Self::settle_import(&mut tx, lease.mailbox).await?;
        tx.commit().await.map_err(db_error)?;
        Ok(CommittedPage {
            queued,
            import_completed,
        })
    }

    async fn reset_stream(&self, lease: &StreamLease) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        let result = sqlx::query!(
            r#"
                         UPDATE
                             email_sync_streams s
                         SET
                             position = NULL,
                             initial_complete = false,
                             attachments_rechecked = false,
                             next_run_at = GREATEST(now(), s.provider_retry_at),
                             lease_id = NULL,
                             lease_until = NULL
                         FROM
                             email_links l
                         WHERE
                             s.id = $1 AND s.lease_id = $2 AND s.fence = $3 AND s.lease_until > now() AND l.id = s.link_id AND l.sync_generation = s.generation AND l.is_sync_active AND l.grant_generation = $4
                         "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            lease.mailbox.grant_generation,
        ).execute(&mut *tx).await.map_err(db_error)?;
        if result.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        // The new round opens a pass of its own.
        Self::retire_live_pass(&mut tx, lease).await?;
        // A fresh delta snapshot omits messages deleted while the cursor was
        // expired. Recheck previously known members mailbox-wide so those
        // deletions settle too; a move is never inferred from folder absence.
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import)
            SELECT link_id,$2,provider_id,true FROM email_messages
            WHERE link_id = $1 AND provider_folder_id = $3 AND provider_id IS NOT NULL
            ON CONFLICT(link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now()
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.folder.as_str()).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn open_live_pass(&self, lease: &StreamLease) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        // Under the link lock, as the round's checkpoint commit is: either the
        // checkpoint retires this pass, or the pass sees the round has ended
        // and opens none.
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        // `import_started_at` is when the import round the pass runs beside
        // started: the claim of the round's first page, just before its first
        // request, whichever page opens the pass (a round recorded before
        // `round_started_at` existed falls back on this page's claim). The
        // pass lists mail received since a few minutes before then
        // (`live_pass::round_start`); the round lists everything older.
        sqlx::query!(
            r#"
            INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,import_started_at)
            SELECT $2,s.link_id,s.generation,'mail_folder_live',s.scope_id,true,COALESCE(s.round_started_at,s.lease_started_at,now())
            FROM email_sync_streams s
            WHERE s.id = $1 AND NOT s.initial_complete
            ON CONFLICT (link_id,generation,kind,scope_id) DO NOTHING
        "#,
            lease.id,
            macro_uuid::generate_uuid_v7()
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn restart_live_pass(&self, lease: &StreamLease) -> Result<(), MailboxError> {
        let result = sqlx::query!(
            r#"
                         UPDATE
                             email_sync_streams s
                         SET
                             position = NULL,
                             import_started_at = now(),
                             next_run_at = GREATEST(now(), s.provider_retry_at),
                             lease_id = NULL,
                             lease_until = NULL
                         FROM
                             email_links l
                         WHERE
                             s.id = $1 AND s.lease_id = $2 AND s.fence = $3 AND s.lease_until > now() AND l.id = s.link_id AND l.sync_generation = s.generation AND l.is_sync_active AND l.grant_generation = $4
                         "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            lease.mailbox.grant_generation,
        ).execute(&self.db).await.map_err(db_error)?;
        if result.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn release_stream(
        &self,
        lease: &StreamLease,
        retry: SyncRetry,
    ) -> Result<(), MailboxError> {
        sqlx::query!(
            r#"
            UPDATE
                email_sync_streams
            SET
                lease_id = NULL,
                lease_until = NULL,
                provider_retry_at = CASE
                    WHEN provider = 'IMAP' AND $5 THEN GREATEST(provider_retry_at, now() + make_interval(secs => $4))
                    ELSE provider_retry_at
                END,
                next_run_at = CASE
                    WHEN provider = 'IMAP' THEN GREATEST(
                        CASE
                            WHEN NOT $5 AND notification_revision > leased_notification_revision THEN clock_timestamp()
                            ELSE now() + make_interval(secs => $4)
                        END,
                        provider_retry_at
                    )
                    ELSE now() + make_interval(secs => $4)
                END
            WHERE
                id = $1
                AND lease_id = $2
                AND fence = $3
            "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            f64::from(retry.seconds()),
            retry.is_provider(),
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?;
        Ok(())
    }

    async fn pace_import(
        &self,
        lease: &StreamLease,
        queued: u32,
        delay: u32,
    ) -> Result<bool, MailboxError> {
        // The count reads `email_message_reconciliation_import_queued`, whose
        // predicate it repeats, and stops at `queued` rows. Rows backed off
        // after failures of their own don't count: they would hold the walk
        // while nothing could be claimed.
        let paced = sqlx::query!(
            r#"
            WITH queued AS (
                SELECT count(*) AS rows FROM (
                    SELECT 1 FROM email_message_reconciliation
                    WHERE link_id = $1 AND generation = $2 AND is_import AND available_at <> 'infinity'
                        AND available_at <= now()
                    LIMIT $3
                ) q
            )
            UPDATE email_sync_streams s SET lease_id = NULL, lease_until = NULL, next_run_at = GREATEST(now() + make_interval(secs => $7), s.provider_retry_at)
            FROM queued WHERE queued.rows >= $3 AND s.id = $4 AND s.lease_id = $5 AND s.fence = $6
        "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            i64::from(queued),
            lease.id,
            lease.lease_id,
            lease.fence,
            f64::from(delay),
        )
            .execute(&self.db).await.map_err(db_error)?;
        Ok(paced.rows_affected() == 1)
    }

    async fn claim_message(&self, lease_id: Uuid) -> Result<SyncClaim<MessageLease>, MailboxError> {
        self.claim_message_lease(lease_id).await
    }

    async fn folders(&self, mailbox: MailboxKey) -> Result<Vec<MailFolder>, MailboxError> {
        let rows = sqlx::query!(
            r#"
            SELECT
                f.provider_id,
                f.parent_id,
                f.display_name,
                f.role,
                f.total_item_count,
                f.sync_enabled
            FROM
                email_mailbox_folders f
                JOIN email_links l ON l.id = f.link_id
            WHERE
                f.link_id = $1
                AND l.sync_generation = $2
                AND l.is_sync_active
                AND f.deleted_at IS NULL
            "#,
            mailbox.link_id,
            mailbox.sync_generation,
        )
        .fetch_all(&self.db)
        .await
        .map_err(db_error)?;
        rows.into_iter()
            .map(|row| {
                Ok(MailFolder {
                    sync_enabled: row.sync_enabled,
                    id: ProviderId::new(row.provider_id)?,
                    parent_id: row.parent_id.map(ProviderId::new).transpose()?,
                    name: row.display_name,
                    role: serde_json::from_value(serde_json::Value::String(row.role))
                        .map_err(|_| MailboxError::Persistence)?,
                    has_children: false,
                    total_items: row
                        .total_item_count
                        .map(u32::try_from)
                        .transpose()
                        .map_err(|_| MailboxError::Persistence)?,
                })
            })
            .collect()
    }

    async fn complete_message(
        &self,
        lease: &MessageLease,
    ) -> Result<Option<ImportCompleted>, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        sqlx::query!(r#"
            DELETE FROM email_message_reconciliation WHERE link_id = $1 AND generation = $2 AND provider_id = $3
                AND revision = $4 AND lease_id = $5 AND lease_until > now()
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.revision,lease.lease_id)
            .execute(&mut *tx).await.map_err(db_error)?;
        // A new page may have coalesced another wakeup into the leased row. Its
        // notification time stays only if a newer notification brought it.
        sqlx::query!(r#"
            UPDATE email_message_reconciliation SET lease_id = NULL,lease_until = NULL,available_at = now(),
                notified_at = CASE WHEN notified_at IS DISTINCT FROM $5 THEN notified_at END
            WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id,
            lease.notification.as_ref().map(|notification| notification.received_at))
            .execute(&mut *tx).await.map_err(db_error)?;
        let import_completed = Self::settle_import(&mut tx, lease.mailbox).await?;
        tx.commit().await.map_err(db_error)?;
        Ok(import_completed)
    }

    async fn release_message(
        &self,
        lease: &MessageLease,
        retry: MessageRetry,
    ) -> Result<(), MailboxError> {
        match retry {
            // A revision queued during the lease (new mail on a message an
            // import was reading) is due at once: the delay was the leased
            // read's, and an import's refusal can leave live reads room.
            MessageRetry::After { seconds, counted } => {
                sqlx::query!(r#"
                    UPDATE email_message_reconciliation SET lease_id = NULL,lease_until = NULL,
                        available_at = CASE WHEN revision = $7 THEN now() + make_interval(secs => $5) ELSE now() END,
                        attempts = attempts - CASE WHEN $6 THEN 0 ELSE 1 END
                    WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4
                "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id,f64::from(seconds),counted,lease.revision)
                    .execute(&self.db).await.map_err(db_error)?;
            }
            // `available_at = 'infinity'` is the abandoned state: claims stop at
            // their index's `available_at <= now()` bound, and every enqueue sets
            // `available_at = now()`, which revives the row with fresh attempts.
            // A revision that arrived during the lease is retried instead.
            MessageRetry::Abandon => {
                sqlx::query!(r#"
                    UPDATE email_message_reconciliation SET lease_id = NULL,lease_until = NULL,attempts = 0,
                        available_at = CASE WHEN revision = $5 THEN 'infinity'::timestamptz ELSE now() END
                    WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4
                "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id,lease.revision)
                    .execute(&self.db).await.map_err(db_error)?;
            }
        }
        Ok(())
    }
}

impl PgMailboxSync {
    async fn retire_live_pass(
        tx: &mut sqlx::PgConnection,
        lease: &StreamLease,
    ) -> Result<(), MailboxError> {
        sqlx::query!(
            r#"
            DELETE FROM email_sync_streams
            WHERE link_id = $1 AND generation = $2 AND kind = 'mail_folder_live' AND scope_id = $3
        "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            lease.folder.as_str()
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Ok(())
    }

    async fn lock_attachment_completion(
        tx: &mut sqlx::PgConnection,
        mailbox: MailboxKey,
    ) -> Result<(), MailboxError> {
        let active=sqlx::query!("SELECT id FROM email_links WHERE id=$1 AND sync_generation=$2 AND grant_generation=$3 AND is_sync_active FOR UPDATE",mailbox.link_id,mailbox.sync_generation,mailbox.grant_generation)
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        if active.is_none() {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    // Called under the link lock after each page or reconciliation, so one
    // caller at a time sees the import finish.
    async fn settle_import(
        tx: &mut sqlx::PgConnection,
        mailbox: MailboxKey,
    ) -> Result<Option<ImportCompleted>, MailboxError> {
        let state = sqlx::query!(r#"SELECT
            EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind='folder_catalog' AND initial_complete) AS "catalog_complete!",
            EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind='folder_catalog' AND import_completed_at IS NULL) AS "import_open!",
            EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind='mail_folder' AND NOT attachments_rechecked) AS "recheck_pending!",
            EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind IN ('mail_folder','folder_catalog') AND NOT initial_complete) AS "streams_incomplete!",
            EXISTS(SELECT 1 FROM email_message_reconciliation WHERE link_id=$1 AND generation=$2 AND available_at <> 'infinity') AS "queued!",
            EXISTS(SELECT 1 FROM email_message_reconciliation WHERE link_id=$1 AND generation=$2 AND is_import AND available_at <> 'infinity') AS "imports_queued!"
        "#,mailbox.link_id,mailbox.sync_generation).fetch_one(&mut *tx).await.map_err(db_error)?;
        let enumerated = state.catalog_complete && !state.streams_incomplete;
        // All correspondence is now ingested, regardless of folder/page delivery order.
        if enumerated && state.recheck_pending && !state.queued {
            // Rechecks read current state and claim uploads, so their relative order is immaterial.
            sqlx::query!(r#"
                INSERT INTO email_projection_outbox(id,link_id,generation,payload)
                SELECT gen_random_uuid(),m.link_id,$2,jsonb_build_object('kind','attachment_recheck','message_id',m.id)
                FROM email_messages m WHERE m.link_id=$1 AND m.provider_id IS NOT NULL AND NOT m.is_draft
                    AND EXISTS(SELECT 1 FROM email_attachments a WHERE a.message_id=m.id AND a.reference_url IS NULL)
            "#,mailbox.link_id,mailbox.sync_generation).execute(&mut *tx).await.map_err(db_error)?;
            sqlx::query!("UPDATE email_sync_streams SET attachments_rechecked=true WHERE link_id=$1 AND generation=$2 AND kind='mail_folder'",mailbox.link_id,mailbox.sync_generation)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        // The import run is done once every folder is enumerated and no import
        // row is left but abandoned ones; live changes may still be queued.
        if !(enumerated && state.import_open && !state.imports_queued) {
            return Ok(None);
        }
        let Some(run) = sqlx::query!(r#"
            UPDATE email_sync_streams SET import_completed_at = now()
            WHERE link_id=$1 AND generation=$2 AND kind='folder_catalog' AND import_completed_at IS NULL
            RETURNING import_started_at, import_completed_at AS "completed_at!"
        "#,mailbox.link_id,mailbox.sync_generation).fetch_optional(&mut *tx).await.map_err(db_error)? else {
            return Ok(None);
        };
        let size = sqlx::query!(r#"SELECT
            (SELECT count(*) FROM email_messages WHERE link_id=$1 AND provider_id IS NOT NULL) AS "messages!",
            (SELECT count(*) FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind='mail_folder') AS "folders!"
        "#,mailbox.link_id,mailbox.sync_generation).fetch_one(&mut *tx).await.map_err(db_error)?;
        let dedupe_key = format!(
            "import-completed/{}/{}",
            mailbox.link_id, mailbox.sync_generation
        );
        let payload = serde_json::to_value(
            crate::domain::mailbox::projection::ProjectionEvent::ImportCompleted,
        )
        .map_err(|_| MailboxError::Persistence)?;
        sqlx::query!(
            r#"
            INSERT INTO email_projection_outbox (id, link_id, generation, payload, dedupe_key)
                VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (dedupe_key)
                DO NOTHING
            "#,
            macro_uuid::generate_uuid_v7(),
            mailbox.link_id,
            mailbox.sync_generation,
            payload,
            dedupe_key,
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Ok(Some(ImportCompleted {
            mailbox,
            started_at: run.import_started_at,
            completed_at: run.completed_at,
            messages: size.messages,
            folders: size.folders,
        }))
    }
}

/// The pending notification stored with sync work, if any.
fn notification(
    received_at: Option<chrono::DateTime<chrono::Utc>>,
    traceparent: Option<String>,
) -> Option<Notification> {
    let received_at = received_at?;
    Some(Notification {
        received_at,
        traceparent,
    })
}
