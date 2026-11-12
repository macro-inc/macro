//! Thread state writes shared with annotation transactions.

use super::*;

impl PgMessageRepository {
    /// Resolve the deferred reply FK before taking the channel counter lock.
    /// Without this lock, a root edit could hold the root while waiting for our
    /// counter, and COMMIT would then wait for that root to check the reply FK.
    pub(super) async fn lock_channel_reply_root_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> Result<bool, MessageError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT m.id FROM comms_messages m
               JOIN comms_message_threads t ON t.root_id = m.id
               WHERE m.id = $1 AND m.parent_entity_type = $2 AND m.parent_entity_id = $3
                   AND t.deleted_at IS NULL FOR KEY SHARE OF m"#,
            root_id,
            parent.entity_type(),
            parent.entity_id(),
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(database_error)?
        .is_some())
    }

    /// Delete a discussion within an existing annotation transaction.
    /// The caller must already have authorized the enclosing annotation operation.
    pub async fn delete_thread_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> Result<ThreadState, MessageError> {
        Self::set_thread_in(tx, parent, root_id, ThreadPatch::default(), true)
            .await
            .map(|(state, _)| state)
    }

    pub(super) async fn set_thread(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
        patch: ThreadPatch,
        delete: bool,
    ) -> Result<(ThreadState, Option<i64>), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        let (state, seq) = Self::set_thread_in(&mut tx, parent, root_id, patch, delete).await?;
        tx.commit().await.map_err(database_error)?;
        Ok((state, seq))
    }

    async fn set_thread_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        root_id: Uuid,
        patch: ThreadPatch,
        delete: bool,
    ) -> Result<(ThreadState, Option<i64>), MessageError> {
        let state = sqlx::query_scalar!(
            r#"SELECT to_jsonb(t) AS "state!: Json<ThreadState>" FROM comms_message_threads t
               WHERE t.root_id = $1 AND t.parent_entity_type = $2 AND t.parent_entity_id = $3
                   AND t.deleted_at IS NULL FOR UPDATE"#,
            root_id,
            parent.entity_type(),
            parent.entity_id(),
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(database_error)?
        .ok_or(MessageError::NotFound)?;
        if delete {
            sqlx::query!("UPDATE comms_messages SET deleted_at = COALESCE(deleted_at, now()), updated_at = now(), content = '' WHERE id = $1 OR thread_id = $1", root_id)
                .execute(&mut **tx).await.map_err(database_error)?;
            if matches!(state.anchor, Some(ThreadAnchor::PdfPlaceable { .. })) {
                sqlx::query!(
                    r#"DELETE FROM "PdfPlaceableCommentAnchor" WHERE root_id = $1"#,
                    root_id
                )
                .execute(&mut **tx)
                .await
                .map_err(database_error)?;
            }
            if matches!(state.anchor, Some(ThreadAnchor::PdfHighlight { .. })) {
                sqlx::query!(
                    r#"UPDATE "PdfHighlightAnchor" SET root_id = NULL WHERE root_id = $1"#,
                    root_id
                )
                .execute(&mut **tx)
                .await
                .map_err(database_error)?;
            }
        }
        let mut result = sqlx::query_scalar!(
            r#"UPDATE comms_message_threads t SET resolved = COALESCE($2, resolved), updated_at = now(),
                   deleted_at = CASE WHEN $3 THEN now() ELSE deleted_at END,
                   anchor = CASE WHEN $4 OR ($3 AND anchor->>'type' <> 'markdown') THEN NULL ELSE anchor END
               WHERE root_id = $1 RETURNING to_jsonb(t) AS "state!: Json<ThreadState>""#,
            root_id, patch.resolved, delete, patch.detach_anchor,
        ).fetch_one(&mut **tx).await.map_err(database_error)?;
        Self::resolve_highlight_text(&mut **tx, [&mut result.0]).await?;
        let seq = Self::append_message_change_in(tx, parent, root_id).await?;
        Ok((result.0, seq))
    }
}
