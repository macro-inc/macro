//! Slack file downloads (session service): reserved at ingest, claimed by
//! the observing account's replica, staged in `external_chat_media_blob` for
//! DSS's import. Slack gives no hash first, so the hash is of what arrived.

use super::*;
use external_chat::outbound::pg::{fail_attachment_in, lock_chat_in};
use sha2::{Digest, Sha256};

/// Download attempts before the attachment is shown as unavailable.
const MAX_DOWNLOAD_ATTEMPTS: i32 = 5;

/// Reserve one attachment per file of a stored message, downloaded by
/// `observer`. Unsupported types fail at once.
pub(super) async fn reserve_files_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
    person: Uuid,
    message: &InboundMessage,
    observer: Uuid,
) -> ExternalChatResult<()> {
    for (ordinal, file) in message.files.iter().take(10).enumerate() {
        let mime = file
            .mime
            .clone()
            .unwrap_or_else(|| "application/octet-stream".to_owned());
        let state = if MediaKind::of(&mime).is_some() {
            "pending"
        } else {
            "failed"
        };
        let ordinal = i16::try_from(ordinal).map_err(failure)?;
        let dimension = |value: Option<u32>| {
            value
                .filter(|value| *value > 0)
                .and_then(|value| i32::try_from(value).ok())
        };
        sqlx::query!(
            r#"INSERT INTO external_chat_attachment (chat_id, person_id, source_id, ordinal, blob_id, state, account_id,
                locator, mime, filename, size, width, height, duration_seconds)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (chat_id, person_id, source_id, ordinal) DO UPDATE SET account_id = excluded.account_id
            WHERE external_chat_attachment.state = 'pending'
              AND (external_chat_attachment.claimed_until IS NULL OR external_chat_attachment.claimed_until < now())"#,
            chat,
            person,
            message.ts,
            ordinal,
            Uuid::now_v7(),
            state,
            observer,
            file.file_id.as_bytes(),
            mime,
            file.filename.chars().take(255).collect::<String>(),
            file.size.and_then(|size| i64::try_from(size).ok()),
            dimension(file.width),
            dimension(file.height),
            file.duration_seconds.and_then(|seconds| i32::try_from(seconds).ok())
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    Ok(())
}

pub(super) async fn claim_media(
    pool: &PgPool,
    scope: SessionScope,
    limit: i64,
) -> ExternalChatResult<Vec<MediaImport>> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
    let rows = sqlx::query!(
        r#"UPDATE external_chat_attachment a SET claimed_until = now() + interval '5 minutes'
        WHERE (a.chat_id, a.person_id, a.source_id, a.ordinal) IN (
            SELECT chat_id, person_id, source_id, ordinal FROM external_chat_attachment
            WHERE account_id = $1 AND state = 'pending' AND retry_at <= now()
              AND (claimed_until IS NULL OR claimed_until < now())
            ORDER BY retry_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING a.chat_id, a.person_id, a.source_id, a.ordinal, a.locator AS "locator!""#,
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
                file_id: String::from_utf8(row.locator).map_err(|_| corrupt("a Slack file id"))?,
            })
        })
        .collect()
}

pub(super) async fn complete_media(
    pool: &PgPool,
    scope: SessionScope,
    attachment: &AttachmentRef,
    bytes: &[u8],
) -> ExternalChatResult<()> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
    lock_chat_in(&mut tx, attachment.chat_id).await?;
    let Some(row) = sqlx::query!(
        r#"SELECT a.blob_id, a.state, a.mime AS "mime!", a.filename AS "filename!", e.user_id
        FROM external_chat_attachment a JOIN external_chat e ON e.id = a.chat_id
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
    else {
        return Err(ExternalChatError::NotFound.into());
    };
    // Ready, failed or deleted attachments are never rewritten.
    if row.state != "pending" {
        return Ok(());
    }
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    sqlx::query!(
        r#"INSERT INTO external_chat_media_blob (id, chat_id, user_id, mime, filename, sha256, bytes)
        VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING"#,
        row.blob_id,
        attachment.chat_id,
        row.user_id,
        row.mime,
        row.filename,
        &digest[..],
        bytes
    )
    .execute(&mut *tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        r#"UPDATE external_chat_attachment SET state = 'downloaded', sha256 = $5, size = $6, claimed_until = NULL,
            locator = NULL, attempts = 0, retry_at = now()
        WHERE chat_id = $1 AND person_id = $2 AND source_id = $3 AND ordinal = $4"#,
        attachment.chat_id,
        attachment.person_id,
        attachment.source_id,
        attachment.ordinal,
        &digest[..],
        i64::try_from(bytes.len()).unwrap_or(i64::MAX)
    )
    .execute(&mut *tx)
    .await
    .map_err(failure)?;
    notify(&mut tx, external_chat::signals::MEDIA_READY, row.blob_id).await?;
    tx.commit().await.map_err(failure)
}

pub(super) async fn fail_media(
    pool: &PgPool,
    scope: SessionScope,
    attachment: &AttachmentRef,
    reason: MediaFailure,
) -> ExternalChatResult<()> {
    let mut tx = pool.begin().await.map_err(failure)?;
    let account = fence_in(&mut tx, scope, false).await?;
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
