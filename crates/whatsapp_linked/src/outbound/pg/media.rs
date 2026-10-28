//! Attachment downloads (session service) and their import into static files
//! (DSS). States: `pending` → `downloaded` (bytes in `whatsapp_media_blob`) →
//! `ready` (`file_id` set), or `failed`; `deleted` follows the message. A file
//! an attachment lets go of is queued in `whatsapp_file_deletion` by a trigger.

use super::*;
use crate::domain::{
    events::*,
    ports::{FileImport, MediaRepository},
};
use async_trait::async_trait;
use sha2::{Digest, Sha256};

/// Download attempts before the attachment is shown as unavailable.
const MAX_DOWNLOAD_ATTEMPTS: i32 = 5;

/// Mark one attachment failed and tell readers on its message.
async fn fail_in(
    tx: &mut Transaction<'_, Postgres>,
    attachment: &AttachmentRef,
) -> LinkedResult<()> {
    let row = sqlx::query!(
        r#"UPDATE whatsapp_group_attachment a SET state = 'failed', claimed_until = NULL, locator = NULL
        FROM whatsapp_group_message m, whatsapp_group b
        WHERE a.binding_id = $1 AND a.person_id = $2 AND a.source_id = $3 AND a.ordinal = $4
          AND a.state IN ('pending', 'downloaded')
          AND m.binding_id = a.binding_id AND m.person_id = a.person_id AND m.source_id = a.source_id
          AND b.id = a.binding_id
        RETURNING a.blob_id, a.filename, m.message_id, b.id AS group_id"#,
        attachment.binding_id,
        attachment.person_id,
        attachment.source_id,
        attachment.ordinal
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    let Some(row) = row else { return Ok(()) };
    sqlx::query!("DELETE FROM whatsapp_media_blob WHERE id = $1", row.blob_id)
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    if let Some(message) = row.message_id {
        bump_in(tx, attachment, message).await?;
    }
    Ok(())
}

/// Queue publication of the attachment's message.
async fn bump_in(
    tx: &mut Transaction<'_, Postgres>,
    attachment: &AttachmentRef,
    message: Uuid,
) -> LinkedResult<()> {
    sqlx::query!(
        r#"UPDATE whatsapp_group_message SET effect_revision = effect_revision + 1, notification_retry_at = now()
        WHERE binding_id = $1 AND person_id = $2 AND source_id = $3"#,
        attachment.binding_id,
        attachment.person_id,
        attachment.source_id
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    notify(tx, signals::GROUP_EFFECTS, message).await?;
    notify_change(
        tx,
        signals::Change::Group {
            group_id: attachment.binding_id,
        },
    )
    .await
}

impl PgLinkedRepository {
    pub(super) async fn claim_media_imports(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> LinkedResult<Vec<MediaImport>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(vec![]);
        }
        let rows = sqlx::query!(
            r#"UPDATE whatsapp_group_attachment a SET claimed_until = now() + interval '5 minutes'
            WHERE (a.binding_id, a.person_id, a.source_id, a.ordinal) IN (
                SELECT binding_id, person_id, source_id, ordinal FROM whatsapp_group_attachment
                WHERE account_id = $1 AND state = 'pending' AND retry_at <= now()
                  AND (claimed_until IS NULL OR claimed_until < now())
                ORDER BY retry_at LIMIT $2 FOR UPDATE SKIP LOCKED)
            RETURNING a.binding_id, a.person_id, a.source_id, a.ordinal, a.mime AS "mime!", a.filename AS "filename!",
                a.size AS "size!", a.sha256, a.locator AS "locator!""#,
            account.id,
            limit
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        rows.into_iter()
            .map(|row| {
                Ok(MediaImport {
                    attachment: AttachmentRef {
                        binding_id: row.binding_id,
                        person_id: row.person_id,
                        source_id: row.source_id,
                        ordinal: row.ordinal,
                    },
                    mime: row.mime,
                    filename: row.filename,
                    size: row.size.max(0) as u64,
                    sha256: row
                        .sha256
                        .try_into()
                        .map_err(|_| corrupt("sha256 is not 32 bytes"))?,
                    locator: row.locator,
                })
            })
            .collect()
    }

    pub(super) async fn complete_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        bytes: &[u8],
    ) -> LinkedResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        lock_group_in(&mut tx, attachment.binding_id).await?;
        let row = sqlx::query!(
            r#"SELECT a.blob_id, a.sha256, a.state, a.mime AS "mime!", a.filename AS "filename!", b.id AS group_id, b.user_id
            FROM whatsapp_group_attachment a JOIN whatsapp_group b ON b.id = a.binding_id
            WHERE a.binding_id = $1 AND a.person_id = $2 AND a.source_id = $3 AND a.ordinal = $4 AND a.account_id = $5
            FOR UPDATE OF a"#,
            attachment.binding_id,
            attachment.person_id,
            attachment.source_id,
            attachment.ordinal,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(LinkedError::NotFound)?;
        // Ready, failed or deleted attachments are never rewritten.
        if row.state != "pending" {
            return Ok(());
        }
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        if digest[..] != row.sha256[..] {
            fail_in(&mut tx, attachment).await?;
            tx.commit().await.map_err(failure)?;
            return Err(LinkedError::Invalid("attachment bytes do not match their hash").into());
        }
        sqlx::query!(
            r#"INSERT INTO whatsapp_media_blob (id, group_id, user_id, mime, filename, sha256, bytes)
            VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING"#,
            row.blob_id,
            row.group_id,
            row.user_id,
            row.mime,
            row.filename,
            row.sha256,
            bytes
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!(
            r#"UPDATE whatsapp_group_attachment SET state = 'downloaded', claimed_until = NULL, locator = NULL, attempts = 0, retry_at = now()
            WHERE binding_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4"#,
            attachment.binding_id,
            attachment.person_id,
            attachment.source_id,
            attachment.ordinal
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        notify(&mut tx, signals::MEDIA_READY, row.blob_id).await?;
        tx.commit().await.map_err(failure)
    }

    pub(super) async fn fail_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        reason: MediaFailure,
    ) -> LinkedResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        lock_group_in(&mut tx, attachment.binding_id).await?;
        let attempts = sqlx::query_scalar!(
            r#"UPDATE whatsapp_group_attachment SET attempts = attempts + 1, claimed_until = NULL,
                retry_at = now() + least(interval '1 minute' * power(2, attempts), interval '6 hours')
            WHERE binding_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4 AND account_id = $5 AND state = 'pending'
            RETURNING attempts"#,
            attachment.binding_id,
            attachment.person_id,
            attachment.source_id,
            attachment.ordinal,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        if let Some(attempts) = attempts
            && (reason == MediaFailure::Permanent || attempts >= MAX_DOWNLOAD_ATTEMPTS)
        {
            fail_in(&mut tx, attachment).await?;
        }
        tx.commit().await.map_err(failure)
    }
}

#[async_trait]
impl MediaRepository for PgLinkedRepository {
    async fn due_imports(&self, limit: i64) -> LinkedResult<Vec<FileImport>> {
        // Claiming pushes retry_at forward, so DSS replicas don't import twice.
        let rows = sqlx::query!(
            r#"UPDATE whatsapp_group_attachment a SET retry_at = now() + interval '5 minutes'
            FROM whatsapp_media_blob blob
            WHERE (a.binding_id, a.person_id, a.source_id, a.ordinal) IN (
                SELECT binding_id, person_id, source_id, ordinal FROM whatsapp_group_attachment
                WHERE state = 'downloaded' AND retry_at <= now()
                ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
              AND blob.id = a.blob_id
            RETURNING a.binding_id, a.person_id, a.source_id, a.ordinal, a.blob_id, a.attempts,
                blob.group_id, blob.user_id, blob.filename, blob.mime"#,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        Ok(rows
            .into_iter()
            .map(|row| FileImport {
                attachment: AttachmentRef {
                    binding_id: row.binding_id,
                    person_id: row.person_id,
                    source_id: row.source_id,
                    ordinal: row.ordinal,
                },
                blob_id: row.blob_id,
                group_id: row.group_id,
                owner: row.user_id,
                filename: row.filename,
                mime: row.mime,
                attempts: row.attempts,
            })
            .collect())
    }

    async fn import_bytes(&self, import: &FileImport) -> LinkedResult<Option<Vec<u8>>> {
        sqlx::query_scalar!(
            "SELECT bytes FROM whatsapp_media_blob WHERE id = $1",
            import.blob_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)
    }

    async fn import_stored(&self, import: &FileImport, file_id: Uuid) -> LinkedResult<()> {
        let attachment = &import.attachment;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        lock_group_in(&mut tx, import.attachment.binding_id).await?;
        let row = sqlx::query!(
            r#"UPDATE whatsapp_group_attachment a SET state = 'ready', file_id = $5
            FROM whatsapp_group_message m
            WHERE a.binding_id = $1 AND a.person_id = $2 AND a.source_id = $3 AND a.ordinal = $4 AND a.state = 'downloaded'
              AND m.binding_id = a.binding_id AND m.person_id = a.person_id AND m.source_id = a.source_id
            RETURNING m.message_id"#,
            attachment.binding_id,
            attachment.person_id,
            attachment.source_id,
            attachment.ordinal,
            file_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        match row {
            Some(row) => {
                if let Some(message) = row.message_id {
                    bump_in(&mut tx, attachment, message).await?;
                }
            }
            // Deleted or imported meanwhile: nothing will reference the file.
            None => {
                sqlx::query!(
                    "INSERT INTO whatsapp_file_deletion (file_id) VALUES ($1) ON CONFLICT DO NOTHING",
                    file_id
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
            }
        }
        sqlx::query!(
            "DELETE FROM whatsapp_media_blob WHERE id = $1",
            import.blob_id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }

    async fn import_failed(&self, import: &FileImport, permanent: bool) -> LinkedResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        lock_group_in(&mut tx, import.attachment.binding_id).await?;
        if permanent {
            fail_in(&mut tx, &import.attachment).await?;
        } else {
            let attachment = &import.attachment;
            sqlx::query!(
                r#"UPDATE whatsapp_group_attachment SET attempts = attempts + 1,
                    retry_at = now() + least(interval '1 minute' * power(2, attempts), interval '1 hour')
                WHERE binding_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4 AND state = 'downloaded'"#,
                attachment.binding_id,
                attachment.person_id,
                attachment.source_id,
                attachment.ordinal
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
        }
        tx.commit().await.map_err(failure)
    }

    async fn expire_retained(&self) -> LinkedResult<u64> {
        let uploads = sqlx::query!(
            r#"DELETE FROM whatsapp_media_blob b WHERE b.created_at < now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM whatsapp_group_attachment a WHERE a.blob_id = b.id)"#
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        let receipts = sqlx::query!(
            "DELETE FROM whatsapp_participant_receipt WHERE source_at < now() - make_interval(days => $1)",
            crate::domain::models::RECEIPT_RETENTION_DAYS
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        let pairings = sqlx::query!(
            "DELETE FROM whatsapp_pairing WHERE consumed_at < now() - interval '1 day'"
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected();
        Ok(uploads + receipts + pairings)
    }

    async fn due_file_deletions(&self, limit: i64) -> LinkedResult<Vec<Uuid>> {
        // Claiming pushes retry_at forward, so DSS replicas don't delete twice
        // and a failing file waits before it is tried again.
        sqlx::query_scalar!(
            r#"UPDATE whatsapp_file_deletion SET retry_at = now() + interval '5 minutes'
            WHERE file_id IN (
                SELECT file_id FROM whatsapp_file_deletion WHERE retry_at <= now()
                ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
            RETURNING file_id"#,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn files_deleted(&self, files: &[Uuid]) -> LinkedResult<()> {
        sqlx::query!(
            "DELETE FROM whatsapp_file_deletion WHERE file_id = ANY($1)",
            files
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }
}
