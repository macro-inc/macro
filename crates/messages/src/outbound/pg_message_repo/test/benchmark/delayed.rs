//! Exact writer copies used only to inject an artificial pre-commit hold.
//! Before methods and hydration come from the pinned benchmark baseline;
//! after methods copy the current repository. The only behavioral addition is
//! an async timer after the last statement and before COMMIT, timed separately.

use super::*;

impl PgMessageRepository {
    async fn require_message_delayed_before_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        let rows = sqlx::query_scalar!(r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>"
            FROM comms_messages m WHERE id = $1 AND parent_entity_type = $2 AND parent_entity_id = $3"#,
            id, parent.entity_type(), parent.entity_id()).fetch_all(&mut **tx).await.map_err(database_error)?;
        Self::hydrate_in(tx, rows)
            .await?
            .pop()
            .ok_or(MessageError::NotFound)
    }

    pub(super) async fn create_before_commit_delay(
        &self,
        mut command: CreateMessage,
        delay: Duration,
    ) -> Result<(Message, Duration), MessageError> {
        let mut id = command
            .input
            .id
            .unwrap_or_else(macro_uuid::generate_uuid_v7);
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        if let Some(root_id) = command.canonical_root_id {
            // Serialize the first writers, and coordinate with parent cleanup. A
            // racing first send becomes a reply rather than failing or losing text.
            sqlx::query_scalar!(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock",
                root_id.to_string(),
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            let parent_exists = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM call_entities WHERE id = $1) AS "exists!""#,
                root_id,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            if !parent_exists {
                return Err(MessageError::NotFound);
            }
            let thread_exists = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM comms_message_threads
                    WHERE root_id = $1 AND parent_entity_type = $2 AND parent_entity_id = $3) AS "exists!""#,
                root_id,
                command.parent.entity_type(),
                command.parent.entity_id(),
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            if thread_exists {
                command.input.thread_id = Some(root_id);
            } else {
                id = root_id;
                command.input.thread_id = None;
            }
        }
        if let Some(root_id) = command.input.thread_id {
            // Replies attach to a live root of the same parent. The composite FK
            // only checks parent identity at commit and nothing stops a reply from
            // naming another reply, so the store enforces both here.
            let live_root = sqlx::query_scalar!(
                r#"SELECT EXISTS(
                       SELECT 1 FROM comms_message_threads
                       WHERE root_id = $1 AND parent_entity_type = $2 AND parent_entity_id = $3
                           AND deleted_at IS NULL
                   ) AS "exists!""#,
                root_id,
                command.parent.entity_type(),
                command.parent.entity_id(),
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            if !live_root {
                return Err(MessageError::NotFound);
            }
        }
        sqlx::query!(
            r#"INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, thread_id,
                    sender_id, triggered_by_user_id, triggered_via, content, client_message_id,
                    guest_name, kind)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
            id,
            command.parent.entity_type(),
            command.parent.entity_id(),
            command.input.thread_id,
            command.actor.as_ref(),
            command.triggered_by,
            command.triggered_via,
            command.input.content,
            command.canonical_root_id.and(command.input.id),
            command.guest_name,
            match command.kind {
                MessageKind::Message => "message",
                MessageKind::CallRoot => "call_root",
            },
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        if command.input.thread_id.is_none() {
            Self::ensure_thread_in(&mut tx, id, command.input.anchor.as_ref()).await?;
            Self::attach_pdf_anchor_in(&mut tx, &command, id).await?;
        }
        Self::replace_references(
            &mut tx,
            id,
            command.actor.as_ref(),
            &command.input.mentions,
            Some(&command.input.attachments),
        )
        .await?;
        let message = Self::require_message_delayed_before_in(&mut tx, &command.parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok((message, observed_delay))
    }

    pub(super) async fn edit_before_commit_delay(
        &self,
        parent: &MessageParent,
        id: Uuid,
        command: EditMessage,
        delay: Duration,
    ) -> Result<(Message, Duration), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        let actor = Self::lock_message(&mut tx, parent, id).await?;
        // Attachment-only patches keep the message unedited, as the channel writer did.
        sqlx::query!(
            r#"UPDATE comms_messages SET updated_at = now(),
                   edited_at = CASE WHEN content <> $2 THEN now() ELSE edited_at END,
                   content = $2
               WHERE id = $1"#,
            id,
            command.content
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        Self::replace_references(
            &mut tx,
            id,
            &actor,
            &command.mentions,
            command.attachments.as_deref(),
        )
        .await?;
        let message = Self::require_message_delayed_before_in(&mut tx, parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok((message, observed_delay))
    }

    pub(super) async fn react_before_commit_delay(
        &self,
        parent: &MessageParent,
        id: Uuid,
        user: &str,
        emoji: &str,
        add: bool,
        delay: Duration,
    ) -> Result<(ReactionResult, Duration), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::lock_message(&mut tx, parent, id).await?;
        let result = if add {
            sqlx::query!("INSERT INTO comms_reactions(message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", id, user, emoji)
                .execute(&mut *tx).await.map_err(database_error)?
        } else {
            sqlx::query!(
                "DELETE FROM comms_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
                id,
                user,
                emoji
            )
            .execute(&mut *tx)
            .await
            .map_err(database_error)?
        };
        let message = Self::require_message_delayed_before_in(&mut tx, parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok((
            ReactionResult {
                message,
                changed: result.rows_affected() > 0,
                seq: None,
            },
            observed_delay,
        ))
    }

    pub(super) async fn delete_before_commit_delay(
        &self,
        parent: &MessageParent,
        id: Uuid,
        delay: Duration,
    ) -> Result<(Message, Duration), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::lock_message(&mut tx, parent, id).await?;
        sqlx::query!("UPDATE comms_messages SET content = '', deleted_at = now(), updated_at = now() WHERE id = $1", id)
            .execute(&mut *tx).await.map_err(database_error)?;
        let message = Self::require_message_delayed_before_in(&mut tx, parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok((message, observed_delay))
    }

    pub(super) async fn create_after_commit_delay(
        &self,
        mut command: CreateMessage,
        delay: Duration,
    ) -> Result<((Message, Option<i64>), Duration), MessageError> {
        let mut id = command
            .input
            .id
            .unwrap_or_else(macro_uuid::generate_uuid_v7);
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        if let Some(root_id) = command.canonical_root_id {
            // Serialize the first writers, and coordinate with parent cleanup. A
            // racing first send becomes a reply rather than failing or losing text.
            sqlx::query_scalar!(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock",
                root_id.to_string(),
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            let parent_exists = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM call_entities WHERE id = $1) AS "exists!""#,
                root_id,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            if !parent_exists {
                return Err(MessageError::NotFound);
            }
            let thread_exists = sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM comms_message_threads
                    WHERE root_id = $1 AND parent_entity_type = $2 AND parent_entity_id = $3) AS "exists!""#,
                root_id,
                command.parent.entity_type(),
                command.parent.entity_id(),
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            if thread_exists {
                command.input.thread_id = Some(root_id);
            } else {
                id = root_id;
                command.input.thread_id = None;
            }
        }
        if let Some(root_id) = command.input.thread_id {
            // Replies attach to a live root of the same parent. The composite FK
            // only checks parent identity at commit and nothing stops a reply from
            // naming another reply, so the store enforces both here.
            let live_root = if matches!(command.parent, MessageParent::Channel(_)) {
                Self::lock_channel_reply_root_in(&mut tx, &command.parent, root_id).await?
            } else {
                sqlx::query_scalar!(
                    r#"SELECT EXISTS(
                           SELECT 1 FROM comms_message_threads
                           WHERE root_id = $1 AND parent_entity_type = $2 AND parent_entity_id = $3
                               AND deleted_at IS NULL
                       ) AS "exists!""#,
                    root_id,
                    command.parent.entity_type(),
                    command.parent.entity_id(),
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(database_error)?
            };
            if !live_root {
                return Err(MessageError::NotFound);
            }
        }
        sqlx::query!(
            r#"INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, thread_id,
                    sender_id, triggered_by_user_id, triggered_via, content, client_message_id,
                    guest_name, kind)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
            id,
            command.parent.entity_type(),
            command.parent.entity_id(),
            command.input.thread_id,
            command.actor.as_ref(),
            command.triggered_by,
            command.triggered_via,
            command.input.content,
            command.canonical_root_id.and(command.input.id),
            command.guest_name,
            match command.kind {
                MessageKind::Message => "message",
                MessageKind::CallRoot => "call_root",
            },
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        if command.input.thread_id.is_none() {
            Self::ensure_thread_in(&mut tx, id, command.input.anchor.as_ref()).await?;
            Self::attach_pdf_anchor_in(&mut tx, &command, id).await?;
        }
        Self::replace_references(
            &mut tx,
            id,
            command.actor.as_ref(),
            &command.input.mentions,
            Some(&command.input.attachments),
        )
        .await?;
        let message = Self::require_message_in(&mut tx, &command.parent, id).await?;
        let seq = Self::append_message_change_in(&mut tx, &command.parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok(((message, seq), observed_delay))
    }

    pub(super) async fn edit_after_commit_delay(
        &self,
        parent: &MessageParent,
        id: Uuid,
        command: EditMessage,
        delay: Duration,
    ) -> Result<((Message, Option<i64>), Duration), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        let actor = Self::lock_message(&mut tx, parent, id).await?;
        // Attachment-only patches keep the message unedited, as the channel writer did.
        sqlx::query!(
            r#"UPDATE comms_messages SET updated_at = now(),
                   edited_at = CASE WHEN content <> $2 THEN now() ELSE edited_at END,
                   content = $2
               WHERE id = $1"#,
            id,
            command.content
        )
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
        Self::replace_references(
            &mut tx,
            id,
            &actor,
            &command.mentions,
            command.attachments.as_deref(),
        )
        .await?;
        let message = Self::require_message_in(&mut tx, parent, id).await?;
        let seq = Self::append_message_change_in(&mut tx, parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok(((message, seq), observed_delay))
    }

    pub(super) async fn react_after_commit_delay(
        &self,
        parent: &MessageParent,
        id: Uuid,
        user: &str,
        emoji: &str,
        add: bool,
        delay: Duration,
    ) -> Result<(ReactionResult, Duration), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::lock_message(&mut tx, parent, id).await?;
        let result = if add {
            sqlx::query!("INSERT INTO comms_reactions(message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", id, user, emoji)
                .execute(&mut *tx).await.map_err(database_error)?
        } else {
            sqlx::query!(
                "DELETE FROM comms_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
                id,
                user,
                emoji
            )
            .execute(&mut *tx)
            .await
            .map_err(database_error)?
        };
        let message = Self::require_message_in(&mut tx, parent, id).await?;
        let changed = result.rows_affected() > 0;
        let seq = if changed {
            Self::append_message_change_in(&mut tx, parent, id).await?
        } else {
            None
        };
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok((
            ReactionResult {
                seq,
                message,
                changed,
            },
            observed_delay,
        ))
    }

    pub(super) async fn delete_after_commit_delay(
        &self,
        parent: &MessageParent,
        id: Uuid,
        delay: Duration,
    ) -> Result<((Message, Option<i64>), Duration), MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::lock_message(&mut tx, parent, id).await?;
        sqlx::query!("UPDATE comms_messages SET content = '', deleted_at = now(), updated_at = now() WHERE id = $1", id)
            .execute(&mut *tx).await.map_err(database_error)?;
        let message = Self::require_message_in(&mut tx, parent, id).await?;
        let seq = Self::append_message_change_in(&mut tx, parent, id).await?;
        // Synthetic pre-commit hold: retain the exact SQL and report actual
        // timer delay, which can exceed the requested duration.
        let hold_started = Instant::now();
        tokio::time::sleep(delay).await;
        let observed_delay = hold_started.elapsed();
        tx.commit().await.map_err(database_error)?;
        Ok(((message, seq), observed_delay))
    }
}
