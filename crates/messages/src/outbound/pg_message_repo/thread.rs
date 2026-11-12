//! Thread keysets keep imported and ordinary replies in display order.
use super::*;

impl PgMessageRepository {
    pub(super) async fn read_root(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> Result<Option<MessageListItem>, MessageError> {
        let rows = sqlx::query_scalar!(
            r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
               WHERE m.id = $1 AND m.parent_entity_type = $2 AND m.parent_entity_id = $3
                 AND m.thread_id IS NULL"#,
            root_id,
            parent.entity_type(),
            parent.entity_id(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(self.hydrate_root_rows(rows).await?.pop())
    }

    #[tracing::instrument(err, skip(self, parent), name = "messages.thread_page.query", fields(root_id = %root_id))]
    pub(super) async fn read_thread_page(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
        query: MessageThreadQuery,
    ) -> Result<MessageThreadPage, MessageError> {
        let limit = usize::from(query.limit.unwrap_or(50).clamp(1, 100));
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let (mut rows, older, newer) = if let Some(id) = query.around {
            let anchor = sqlx::query_scalar!(
                r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
                   WHERE m.id = $1 AND m.parent_entity_type = $2 AND m.parent_entity_id = $3
                     AND m.thread_id = $4 AND m.deleted_at IS NULL"#,
                id,
                parent.entity_type(),
                parent.entity_id(),
                root_id,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(database_error)?
            .ok_or(MessageError::NotFound)?;
            let cursor = MessageReplyCursor {
                import_order: anchor.import_order,
                created_at: anchor.created_at,
                id: anchor.id,
            };
            let mut before = Self::reply_rows(
                &mut tx,
                parent,
                root_id,
                Some(&cursor),
                MessageDirection::Older,
                limit as i64 + 1,
            )
            .await?;
            let mut after = Self::reply_rows(
                &mut tx,
                parent,
                root_id,
                Some(&cursor),
                MessageDirection::Newer,
                limit as i64 + 1,
            )
            .await?;
            let mut take_before = before.len().min((limit - 1) / 2);
            let take_after = after.len().min(limit - 1 - take_before);
            take_before = before.len().min(limit - 1 - take_after);
            let older = before.len() > take_before;
            let newer = after.len() > take_after;
            before.truncate(take_before);
            after.truncate(take_after);
            before.push(anchor);
            before.extend(after);
            (before, older, newer)
        } else {
            let mut rows = Self::reply_rows(
                &mut tx,
                parent,
                root_id,
                query.cursor.as_ref(),
                query.direction,
                limit as i64 + 1,
            )
            .await?;
            let more = rows.len() > limit;
            rows.truncate(limit);
            // A cursor can outlive its reply. Probe the other side of the selected
            // window so a stale cursor does not advertise an empty continuation.
            let opposite = if query.cursor.is_some() && !rows.is_empty() {
                let boundary = &rows[0];
                let cursor = MessageReplyCursor {
                    import_order: boundary.import_order,
                    created_at: boundary.created_at,
                    id: boundary.id,
                };
                let direction = match query.direction {
                    MessageDirection::Older => MessageDirection::Newer,
                    MessageDirection::Newer => MessageDirection::Older,
                };
                !Self::reply_rows(&mut tx, parent, root_id, Some(&cursor), direction, 1)
                    .await?
                    .is_empty()
            } else {
                false
            };
            let (older, newer) = match query.direction {
                MessageDirection::Older => (more, opposite),
                MessageDirection::Newer => (opposite, more),
            };
            (rows, older, newer)
        };
        tx.commit().await.map_err(database_error)?;
        rows.sort_by_key(|row| {
            (
                row.import_order.is_none(),
                row.import_order,
                row.created_at,
                row.id,
            )
        });
        let cursor = |row: &Json<StoredMessage>| MessageReplyCursor {
            import_order: row.import_order,
            created_at: row.created_at,
            id: row.id,
        };
        let next_cursor = older.then(|| rows.first()).flatten().map(cursor);
        let previous_cursor = newer.then(|| rows.last()).flatten().map(cursor);
        let replies = self.hydrate(rows).await?;
        let root = self
            .read_root(parent, root_id)
            .await?
            .ok_or(MessageError::NotFound)?;
        Ok(MessageThreadPage {
            root,
            replies,
            next_cursor,
            previous_cursor,
            call: None,
        })
    }

    async fn reply_rows(
        connection: &mut sqlx::PgConnection,
        parent: &MessageParent,
        root_id: Uuid,
        cursor: Option<&MessageReplyCursor>,
        direction: MessageDirection,
        limit: i64,
    ) -> Result<Vec<Json<StoredMessage>>, MessageError> {
        let import_order = cursor.and_then(|cursor| cursor.import_order);
        let imported_cursor = cursor.filter(|cursor| cursor.import_order.is_some());
        let ordinary_cursor = cursor.filter(|cursor| cursor.import_order.is_none());
        let all_imported =
            imported_cursor.is_none() && (cursor.is_none() || direction == MessageDirection::Older);
        let all_ordinary =
            ordinary_cursor.is_none() && (cursor.is_none() || direction == MessageDirection::Newer);
        // Each bucket selects ordering keys before hydrating complete messages.
        // OFFSET 0 keeps parent/live checks as primary-key probes before LIMIT.
        // Only the final bounded merge is hydrated into complete message rows.
        match direction {
            MessageDirection::Older => sqlx::query_file_scalar!(
                "src/outbound/pg_message_repo/thread_older.sql",
                parent.entity_type(),
                parent.entity_id(),
                root_id,
                import_order,
                imported_cursor.map(|c| c.created_at),
                imported_cursor.map(|c| c.id),
                all_imported,
                ordinary_cursor.map(|c| c.created_at),
                ordinary_cursor.map(|c| c.id),
                all_ordinary,
                limit,
            )
            .fetch_all(connection)
            .await
            .map_err(database_error),
            MessageDirection::Newer => sqlx::query_file_scalar!(
                "src/outbound/pg_message_repo/thread_newer.sql",
                parent.entity_type(),
                parent.entity_id(),
                root_id,
                import_order,
                imported_cursor.map(|c| c.created_at),
                imported_cursor.map(|c| c.id),
                all_imported,
                ordinary_cursor.map(|c| c.created_at),
                ordinary_cursor.map(|c| c.id),
                all_ordinary,
                limit,
            )
            .fetch_all(connection)
            .await
            .map_err(database_error),
        }
    }
}
