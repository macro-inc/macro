//! Added external chat entities, their attachments and staged uploads.
use super::*;
use crate::domain::ports::{ChatRepository, StagedUpload};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;

/// A shape value as an integer column.
fn column(value: Option<u32>) -> Option<i32> {
    value.map(|value| value.min(i32::MAX as u32) as i32)
}

#[async_trait]
impl ChatRepository for PgExternalChatRepository {
    async fn chat(&self, chat: Uuid) -> ExternalChatResult<Option<ChatRef>> {
        sqlx::query_as!(ChatRow, "SELECT id, provider, remote_id, kind, user_id, state, adopted_at FROM external_chat WHERE id = $1", chat)
            .fetch_optional(&self.pool).await.map_err(failure)?.map(chat_ref).transpose()
    }

    async fn message_attachments(
        &self,
        chat: &ChatRef,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<MessageAttachments>> {
        let rows = sqlx::query!(
            r#"SELECT m.message_id AS "message_id!", a.ordinal, a.state, a.filename, a.mime, a.size, a.file_id,
                a.width, a.height, a.duration_seconds, a.presentation
            FROM external_chat_attachment a
            JOIN external_chat_message m ON m.chat_id = a.chat_id AND m.person_id = a.person_id AND m.source_id = a.source_id
            WHERE a.chat_id = $1 AND m.message_id = ANY($2) AND a.state <> 'deleted'
            ORDER BY m.message_id, a.ordinal"#,
            chat.id,
            messages
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        let mut result: Vec<MessageAttachments> = vec![];
        for row in rows {
            let mime = row.mime.unwrap_or_default();
            let state = match row.state.as_str() {
                "ready" => AttachmentState::Ready,
                "failed" if MediaKind::of(&mime).is_none() => AttachmentState::Unsupported,
                "failed" => AttachmentState::Unavailable,
                _ => AttachmentState::Loading,
            };
            let attachment = Attachment {
                ordinal: row.ordinal,
                state,
                file_name: row.filename.unwrap_or_default(),
                mime,
                size: row.size.unwrap_or(0).max(0) as u64,
                file_id: row.file_id,
                width: row.width.map(|value| value.max(0) as u32),
                height: row.height.map(|value| value.max(0) as u32),
                duration_seconds: row.duration_seconds.map(|value| value.max(0) as u32),
                presentation: row
                    .presentation
                    .as_deref()
                    .and_then(MediaPresentation::parse),
            };
            match result.last_mut() {
                Some(last) if last.message_id == row.message_id => {
                    last.attachments.push(attachment)
                }
                _ => result.push(MessageAttachments {
                    message_id: row.message_id,
                    attachments: vec![attachment],
                }),
            }
        }
        Ok(result)
    }

    async fn stage_upload(&self, upload: StagedUpload<'_>) -> ExternalChatResult<Uuid> {
        let id = Uuid::now_v7();
        sqlx::query!(
            r#"INSERT INTO external_chat_media_blob (id, chat_id, user_id, mime, filename, sha256, bytes, width, height, duration_seconds)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
            id,
            upload.chat_id,
            upload.user.as_ref(),
            upload.mime,
            upload.filename,
            &upload.sha256[..],
            upload.bytes,
            column(upload.shape.width.filter(|width| *width > 0)),
            column(upload.shape.height.filter(|height| *height > 0)),
            column(upload.shape.duration_seconds)
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(id)
    }

    async fn staged_upload_mime(
        &self,
        user: &MacroUserIdStr<'_>,
        chat_id: Uuid,
        upload: Uuid,
    ) -> ExternalChatResult<Option<String>> {
        let user = user.as_ref();
        sqlx::query_scalar!(
            r#"SELECT mime FROM external_chat_media_blob b
            WHERE id = $1 AND chat_id = $2 AND user_id = $3
              AND NOT EXISTS (SELECT 1 FROM external_chat_attachment a WHERE a.blob_id = b.id)"#,
            upload,
            chat_id,
            user
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)
    }
}
