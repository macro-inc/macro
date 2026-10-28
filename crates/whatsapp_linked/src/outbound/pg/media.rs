//! Attachment downloads (session service) and their import into static files
//! (DSS). States: `pending` → `downloaded` (bytes in `external_chat_media_blob`) →
//! `ready` (`file_id` set), or `failed`; `deleted` follows the message. A file
//! an attachment lets go of is queued in `external_chat_file_deletion` by a trigger.

use super::*;
use crate::domain::events::*;
use external_chat::outbound::pg::fail_attachment_in;
use sha2::{Digest, Sha256};

/// Download attempts before the attachment is shown as unavailable.
const MAX_DOWNLOAD_ATTEMPTS: i32 = 5;

impl PgWhatsAppRepository {
    pub(super) async fn claim_media_imports(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<MediaImport>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        if account.state != AccountState::Connected {
            return Ok(vec![]);
        }
        let rows = sqlx::query!(
            r#"UPDATE external_chat_attachment a SET claimed_until = now() + interval '5 minutes'
            WHERE (a.chat_id, a.person_id, a.source_id, a.ordinal) IN (
                SELECT chat_id, person_id, source_id, ordinal FROM external_chat_attachment
                WHERE account_id = $1 AND state = 'pending' AND retry_at <= now()
                  AND (claimed_until IS NULL OR claimed_until < now())
                ORDER BY retry_at LIMIT $2 FOR UPDATE SKIP LOCKED)
            RETURNING a.chat_id, a.person_id, a.source_id, a.ordinal, a.mime AS "mime!", a.filename AS "filename!",
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
                        chat_id: row.chat_id,
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
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        lock_chat_in(&mut tx, attachment.chat_id).await?;
        let row = sqlx::query!(
            r#"SELECT a.blob_id, a.sha256, a.state, a.mime AS "mime!", a.filename AS "filename!", b.id AS chat_id, b.user_id
            FROM external_chat_attachment a JOIN external_chat b ON b.id = a.chat_id
            WHERE a.chat_id = $1 AND a.person_id = $2 AND a.source_id = $3 AND a.ordinal = $4 AND a.account_id = $5
            FOR UPDATE OF a"#,
            attachment.chat_id,
            attachment.person_id,
            attachment.source_id,
            attachment.ordinal,
            account.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?
        .ok_or(ExternalChatError::NotFound)?;
        // Ready, failed or deleted attachments are never rewritten.
        if row.state != "pending" {
            return Ok(());
        }
        let digest: [u8; 32] = Sha256::digest(bytes).into();
        if digest[..] != row.sha256[..] {
            fail_attachment_in(&mut tx, attachment).await?;
            tx.commit().await.map_err(failure)?;
            return Err(
                ExternalChatError::Invalid("attachment bytes do not match their hash").into(),
            );
        }
        sqlx::query!(
            r#"INSERT INTO external_chat_media_blob (id, chat_id, user_id, mime, filename, sha256, bytes)
            VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING"#,
            row.blob_id,
            row.chat_id,
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
            r#"UPDATE external_chat_attachment SET state = 'downloaded', claimed_until = NULL, locator = NULL, attempts = 0, retry_at = now()
            WHERE chat_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4"#,
            attachment.chat_id,
            attachment.person_id,
            attachment.source_id,
            attachment.ordinal
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        notify(&mut tx, external_chat::signals::MEDIA_READY, row.blob_id).await?;
        tx.commit().await.map_err(failure)
    }

    pub(super) async fn fail_media_import(
        &self,
        scope: SessionScope,
        attachment: &AttachmentRef,
        reason: MediaFailure,
    ) -> ExternalChatResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let account = fence_in(&mut tx, scope).await?;
        lock_chat_in(&mut tx, attachment.chat_id).await?;
        let attempts = sqlx::query_scalar!(
            r#"UPDATE external_chat_attachment SET attempts = attempts + 1, claimed_until = NULL,
                retry_at = now() + least(interval '1 minute' * power(2, attempts), interval '6 hours')
            WHERE chat_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4 AND account_id = $5 AND state = 'pending'
            RETURNING attempts"#,
            attachment.chat_id,
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
            fail_attachment_in(&mut tx, attachment).await?;
        }
        tx.commit().await.map_err(failure)
    }
}
