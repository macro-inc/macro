//! Postgres implementation of durable mailbox stream and reconciliation leases.

use crate::domain::mailbox::*;
use email_api_client::domain::models::{
    MailFolder, MailboxChangePage, ProviderId, StreamPosition, StreamToken,
};
use sqlx::PgPool;
use uuid::Uuid;

mod catalog;
mod commands;
mod contacts;
mod credentials;
mod drafts;
mod gmail_history;
mod ingest;
mod lifecycle;
mod projection;
mod settings;
#[cfg(test)]
mod test;
mod watches;

#[derive(Clone)]
pub struct PgMailboxSync {
    pub(super) db: PgPool,
}

impl PgMailboxSync {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    // Serialize only the brief lease-acquisition transactions. Draft and
    // organization workers must atomically observe each other's active leases;
    // no provider IO runs while this lock is held.
    async fn mutation_claim_transaction(
        &self,
    ) -> Result<sqlx::Transaction<'_, sqlx::Postgres>, MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        sqlx::query!("SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('email.outlook.mutation-claims',0))")
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        Ok(tx)
    }
}

fn db_error(_: sqlx::Error) -> MailboxError {
    MailboxError::Persistence
}

impl MailboxSyncRepository for PgMailboxSync {
    async fn renew(&self, lease: SyncLease<'_>) -> Result<(), MailboxError> {
        let updated = match lease {
            SyncLease::Catalog(lease) => self.renew_stream(lease.id,lease.lease_id,lease.fence,lease.mailbox).await?,
            SyncLease::Stream(lease) => self.renew_stream(lease.id,lease.lease_id,lease.fence,lease.mailbox).await?,
            SyncLease::Message(lease) => {
                sqlx::query!(r#"
                    UPDATE email_message_reconciliation q SET lease_until = now() + interval '3 minutes'
                    FROM email_links l WHERE q.link_id = $1 AND q.generation = $2 AND q.provider_id = $3
                        AND q.lease_id = $4 AND q.lease_until > now() AND l.id = q.link_id
                        AND l.sync_generation = q.generation AND l.grant_generation = $5 AND l.is_sync_active
                "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id,lease.mailbox.grant_generation)
                    .execute(&self.db).await.map_err(db_error)?.rows_affected()
            }
        };
        if updated != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }
    async fn claim_catalog(&self, lease_id: Uuid) -> Result<Option<CatalogLease>, MailboxError> {
        self.claim_catalog_lease(lease_id).await
    }
    async fn commit_catalog(
        &self,
        lease: &CatalogLease,
        folders: &[MailFolder],
    ) -> Result<(), MailboxError> {
        self.commit_catalog_lease(lease, folders).await
    }
    async fn release_catalog(&self, lease: &CatalogLease, delay: u32) -> Result<(), MailboxError> {
        self.release_catalog_lease(lease, delay).await
    }
    async fn claim_stream(&self, lease_id: Uuid) -> Result<Option<StreamLease>, MailboxError> {
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT s.id FROM email_sync_streams s JOIN email_links l ON l.id = s.link_id
                WHERE l.is_sync_active AND l.provider = 'OUTLOOK' AND s.generation = l.sync_generation
                    AND s.kind = 'mail_folder' AND s.next_run_at <= now()
                    AND (s.lease_until IS NULL OR s.lease_until < now())
                ORDER BY s.next_run_at, s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED
            )
            UPDATE email_sync_streams s SET lease_id = $1, lease_until = now() + interval '3 minutes', lease_started_at = clock_timestamp(), fence = fence + 1
            FROM candidate c, email_links l WHERE s.id = c.id AND l.id = s.link_id
            RETURNING s.id, s.link_id, s.generation, l.grant_generation, s.scope_id,
                s.position, s.initial_complete, s.fence
        "#, lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|row| {
            Ok(StreamLease {
                id: row.id,
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.generation,
                    grant_generation: row.grant_generation,
                },
                folder: ProviderId::new(row.scope_id)?,
                position: row.position.map(StreamToken::new),
                initial_complete: row.initial_complete,
                lease_id,
                fence: row.fence,
            })
        })
        .transpose()
    }

    async fn commit_page(
        &self,
        lease: &StreamLease,
        page: &MailboxChangePage,
    ) -> Result<(), MailboxError> {
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
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        let advanced = sqlx::query!(
            r#"
            UPDATE email_sync_streams s SET position = $4,
                initial_complete = s.initial_complete OR $5,
                last_completed_at = CASE WHEN $5 THEN now() ELSE last_completed_at END,
                next_run_at = CASE WHEN $5 AND (s.notified_at IS NULL OR s.notified_at <= s.lease_started_at)
                    THEN now() + interval '2 minutes' ELSE now() END,
                lease_id = NULL, lease_until = NULL
            FROM email_links l WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND s.link_id = l.id AND s.generation = l.sync_generation
                AND l.is_sync_active AND l.grant_generation = $6
        "#,
            lease.id,
            lease.lease_id,
            lease.fence,
            position.expose(),
            complete,
            lease.mailbox.grant_generation
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if advanced.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        sqlx::query!(
            r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import)
            SELECT $1,$2,provider_id,$4 FROM unnest($3::text[]) provider_id
            ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET
                revision = email_message_reconciliation.revision + 1,
                is_import = email_message_reconciliation.is_import AND EXCLUDED.is_import,
                available_at = now()
        "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            &ids,
            !lease.initial_complete
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Self::queue_attachment_recheck(&mut tx, lease.mailbox).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn reset_stream(&self, lease: &StreamLease) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        let result = sqlx::query!(r#"
            UPDATE email_sync_streams s SET position = NULL,initial_complete = false,attachments_rechecked = false,next_run_at = now(),lease_id = NULL,lease_until = NULL
            FROM email_links l WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND l.id = s.link_id AND l.sync_generation = s.generation
                AND l.is_sync_active AND l.grant_generation = $4
        "#,lease.id,lease.lease_id,lease.fence,lease.mailbox.grant_generation).execute(&mut *tx).await.map_err(db_error)?;
        if result.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
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

    async fn release_stream(&self, lease: &StreamLease, delay: u32) -> Result<(), MailboxError> {
        sqlx::query!(r#"
            UPDATE email_sync_streams SET lease_id = NULL, lease_until = NULL, next_run_at = now() + make_interval(secs => $4)
            WHERE id = $1 AND lease_id = $2 AND fence = $3
        "#,lease.id,lease.lease_id,lease.fence,f64::from(delay)).execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }

    async fn claim_message(&self, lease_id: Uuid) -> Result<Option<MessageLease>, MailboxError> {
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT q.link_id,q.generation,q.provider_id FROM email_message_reconciliation q
                JOIN email_links l ON l.id = q.link_id
                WHERE q.generation = l.sync_generation AND l.is_sync_active AND l.provider = 'OUTLOOK'
                    AND q.available_at <= now() AND (q.lease_until IS NULL OR q.lease_until < now())
                ORDER BY q.is_import,q.available_at,q.link_id,q.provider_id LIMIT 1 FOR UPDATE OF q SKIP LOCKED
            )
            UPDATE email_message_reconciliation q SET lease_id = $1, lease_until = now() + interval '3 minutes', attempts = attempts + 1
            FROM candidate c,email_links l
            WHERE q.link_id = c.link_id AND q.generation = c.generation AND q.provider_id = c.provider_id AND l.id = q.link_id
            RETURNING q.link_id,q.generation,l.grant_generation,q.provider_id,q.revision,q.is_import,q.attempts
        "#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
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
            })
        })
        .transpose()
    }

    async fn folders(&self, mailbox: MailboxKey) -> Result<Vec<MailFolder>, MailboxError> {
        let rows = sqlx::query!(r#"
            SELECT f.provider_id,f.parent_id,f.display_name,f.role FROM email_mailbox_folders f
            JOIN email_links l ON l.id = f.link_id
            WHERE f.link_id = $1 AND l.sync_generation = $2 AND l.is_sync_active AND f.deleted_at IS NULL
        "#,mailbox.link_id,mailbox.sync_generation).fetch_all(&self.db).await.map_err(db_error)?;
        rows.into_iter()
            .map(|row| {
                Ok(MailFolder {
                    id: ProviderId::new(row.provider_id)?,
                    parent_id: row.parent_id.map(ProviderId::new).transpose()?,
                    name: row.display_name,
                    role: serde_json::from_value(serde_json::Value::String(row.role))
                        .map_err(|_| MailboxError::Persistence)?,
                    has_children: false,
                })
            })
            .collect()
    }

    async fn complete_message(&self, lease: &MessageLease) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_attachment_completion(&mut tx, lease.mailbox).await?;
        sqlx::query!(r#"
            DELETE FROM email_message_reconciliation WHERE link_id = $1 AND generation = $2 AND provider_id = $3
                AND revision = $4 AND lease_id = $5 AND lease_until > now()
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.revision,lease.lease_id)
            .execute(&mut *tx).await.map_err(db_error)?;
        // A new page may have coalesced another wakeup into the leased row.
        sqlx::query!(r#"
            UPDATE email_message_reconciliation SET lease_id = NULL,lease_until = NULL,available_at = now()
            WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id)
            .execute(&mut *tx).await.map_err(db_error)?;
        Self::queue_attachment_recheck(&mut tx, lease.mailbox).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn release_message(&self, lease: &MessageLease, delay: u32) -> Result<(), MailboxError> {
        sqlx::query!(r#"
            UPDATE email_message_reconciliation SET lease_id = NULL,lease_until = NULL,available_at = now() + make_interval(secs => $5)
            WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id,f64::from(delay))
            .execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }
}

impl PgMailboxSync {
    async fn renew_stream(
        &self,
        id: Uuid,
        lease_id: Uuid,
        fence: i64,
        mailbox: MailboxKey,
    ) -> Result<u64, MailboxError> {
        Ok(sqlx::query!(
            r#"
            UPDATE email_sync_streams s SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND l.id = s.link_id AND l.sync_generation = s.generation
                AND l.grant_generation = $4 AND l.is_sync_active
        "#,
            id,
            lease_id,
            fence,
            mailbox.grant_generation
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?
        .rows_affected())
    }
}

impl PgMailboxSync {
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

    // Called under the link lock after the final page or reconciliation. All
    // correspondence is now ingested, regardless of folder/page delivery order.
    async fn queue_attachment_recheck(
        tx: &mut sqlx::PgConnection,
        mailbox: MailboxKey,
    ) -> Result<(), MailboxError> {
        let ready=sqlx::query_scalar!(r#"SELECT (
            EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind='folder_catalog' AND initial_complete)
            AND EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind='mail_folder' AND NOT attachments_rechecked)
            AND NOT EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id=$1 AND generation=$2 AND kind IN ('mail_folder','folder_catalog') AND NOT initial_complete)
            AND NOT EXISTS(SELECT 1 FROM email_message_reconciliation WHERE link_id=$1 AND generation=$2)
        ) AS "ready!""#,mailbox.link_id,mailbox.sync_generation).fetch_one(&mut *tx).await.map_err(db_error)?;
        if !ready {
            return Ok(());
        }
        sqlx::query!(r#"
            INSERT INTO email_projection_outbox(id,link_id,generation,payload)
            SELECT gen_random_uuid(),m.link_id,$2,jsonb_build_object('kind','attachment_recheck','message_id',m.id)
            FROM email_messages m WHERE m.link_id=$1 AND m.provider_id IS NOT NULL AND NOT m.is_draft
                AND EXISTS(SELECT 1 FROM email_attachments a WHERE a.message_id=m.id AND a.reference_url IS NULL)
        "#,mailbox.link_id,mailbox.sync_generation).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!("UPDATE email_sync_streams SET attachments_rechecked=true WHERE link_id=$1 AND generation=$2 AND kind='mail_folder'",mailbox.link_id,mailbox.sync_generation)
            .execute(&mut *tx).await.map_err(db_error)?;
        Ok(())
    }
}
