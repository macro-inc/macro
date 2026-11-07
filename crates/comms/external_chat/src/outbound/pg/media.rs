//! Importing attachment bytes into static files (DSS), and the static files
//! no attachment references any more. Attachment states: `pending` →
//! `downloaded` (bytes in `external_chat_media_blob`) → `ready` (`file_id`
//! set), or `failed`; `deleted` follows the message. A file an attachment
//! lets go of is queued in `external_chat_file_deletion` by a trigger.

use super::*;
use crate::domain::ports::{FileImport, MediaRepository};
use async_trait::async_trait;

/// Mark one attachment failed and tell readers on its message.
pub async fn fail_attachment_in(
    tx: &mut Transaction<'_, Postgres>,
    attachment: &AttachmentRef,
) -> ExternalChatResult<()> {
    let row = sqlx::query!(
        r#"UPDATE external_chat_attachment a SET state = 'failed', claimed_until = NULL, locator = NULL
        FROM external_chat_message m, external_chat b
        WHERE a.chat_id = $1 AND a.person_id = $2 AND a.source_id = $3 AND a.ordinal = $4
          AND a.state IN ('pending', 'downloaded')
          AND m.chat_id = a.chat_id AND m.person_id = a.person_id AND m.source_id = a.source_id
          AND b.id = a.chat_id
        RETURNING a.blob_id, a.filename, m.message_id, b.id AS chat_id"#,
        attachment.chat_id,
        attachment.person_id,
        attachment.source_id,
        attachment.ordinal
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?;
    let Some(row) = row else { return Ok(()) };
    sqlx::query!(
        "DELETE FROM external_chat_media_blob WHERE id = $1",
        row.blob_id
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    if let Some(message) = row.message_id {
        queue_publication_in(tx, attachment, message).await?;
    }
    Ok(())
}

/// Queue publication of the attachment's message.
pub async fn queue_publication_in(
    tx: &mut Transaction<'_, Postgres>,
    attachment: &AttachmentRef,
    message: Uuid,
) -> ExternalChatResult<()> {
    sqlx::query!(
        r#"UPDATE external_chat_message SET effect_revision = effect_revision + 1, notification_retry_at = now()
        WHERE chat_id = $1 AND person_id = $2 AND source_id = $3"#,
        attachment.chat_id,
        attachment.person_id,
        attachment.source_id
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    notify(tx, signals::CHAT_EFFECTS, message).await?;
    notify_change(
        tx,
        signals::Change::Chat {
            chat_id: attachment.chat_id,
        },
    )
    .await
}

#[async_trait]
impl MediaRepository for PgExternalChatRepository {
    async fn due_imports(&self, limit: i64) -> ExternalChatResult<Vec<FileImport>> {
        // Claiming pushes retry_at forward, so DSS replicas don't import twice.
        let rows = sqlx::query!(
            r#"UPDATE external_chat_attachment a SET retry_at = now() + interval '5 minutes'
            FROM external_chat_media_blob blob
            WHERE (a.chat_id, a.person_id, a.source_id, a.ordinal) IN (
                SELECT chat_id, person_id, source_id, ordinal FROM external_chat_attachment
                WHERE state = 'downloaded' AND retry_at <= now()
                ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
              AND blob.id = a.blob_id
            RETURNING a.chat_id, a.person_id, a.source_id, a.ordinal, a.blob_id, a.attempts,
                blob.user_id, blob.filename, blob.mime"#,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        Ok(rows
            .into_iter()
            .map(|row| FileImport {
                attachment: AttachmentRef {
                    chat_id: row.chat_id,
                    person_id: row.person_id,
                    source_id: row.source_id,
                    ordinal: row.ordinal,
                },
                blob_id: row.blob_id,
                chat_id: row.chat_id,
                owner: row.user_id,
                filename: row.filename,
                mime: row.mime,
                attempts: row.attempts,
            })
            .collect())
    }

    async fn import_bytes(&self, import: &FileImport) -> ExternalChatResult<Option<Vec<u8>>> {
        sqlx::query_scalar!(
            "SELECT bytes FROM external_chat_media_blob WHERE id = $1",
            import.blob_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)
    }

    async fn import_stored(&self, import: &FileImport, file_id: Uuid) -> ExternalChatResult<()> {
        let attachment = &import.attachment;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        lock_chat_in(&mut tx, import.attachment.chat_id).await?;
        let row = sqlx::query!(
            r#"UPDATE external_chat_attachment a SET state = 'ready', file_id = $5
            FROM external_chat_message m
            WHERE a.chat_id = $1 AND a.person_id = $2 AND a.source_id = $3 AND a.ordinal = $4 AND a.state = 'downloaded'
              AND m.chat_id = a.chat_id AND m.person_id = a.person_id AND m.source_id = a.source_id
            RETURNING m.message_id"#,
            attachment.chat_id,
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
                    queue_publication_in(&mut tx, attachment, message).await?;
                }
            }
            // Deleted or imported meanwhile: nothing will reference the file.
            None => {
                sqlx::query!(
                    "INSERT INTO external_chat_file_deletion (file_id) VALUES ($1) ON CONFLICT DO NOTHING",
                    file_id
                )
                .execute(&mut *tx)
                .await
                .map_err(failure)?;
            }
        }
        sqlx::query!(
            "DELETE FROM external_chat_media_blob WHERE id = $1",
            import.blob_id
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        tx.commit().await.map_err(failure)
    }

    async fn import_failed(&self, import: &FileImport, permanent: bool) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        lock_chat_in(&mut tx, import.attachment.chat_id).await?;
        if permanent {
            fail_attachment_in(&mut tx, &import.attachment).await?;
        } else {
            let attachment = &import.attachment;
            sqlx::query!(
                r#"UPDATE external_chat_attachment SET attempts = attempts + 1,
                    retry_at = now() + least(interval '1 minute' * power(2, attempts), interval '1 hour')
                WHERE chat_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4 AND state = 'downloaded'"#,
                attachment.chat_id,
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

    async fn expire_uploads(&self) -> ExternalChatResult<u64> {
        Ok(sqlx::query!(
            r#"DELETE FROM external_chat_media_blob b WHERE b.created_at < now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM external_chat_attachment a WHERE a.blob_id = b.id)"#
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?
        .rows_affected())
    }

    async fn due_file_deletions(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        // Claiming pushes retry_at forward, so DSS replicas don't delete twice
        // and a failing file waits before it is tried again.
        sqlx::query_scalar!(
            r#"UPDATE external_chat_file_deletion SET retry_at = now() + interval '5 minutes'
            WHERE file_id IN (
                SELECT file_id FROM external_chat_file_deletion WHERE retry_at <= now()
                ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
            RETURNING file_id"#,
            limit
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn files_deleted(&self, files: &[Uuid]) -> ExternalChatResult<()> {
        sqlx::query!(
            "DELETE FROM external_chat_file_deletion WHERE file_id = ANY($1)",
            files
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }
}
