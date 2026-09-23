use crate::domain::{mentions::MessageReferenceKind, models::*, ports::*};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{PgPool, Postgres, Transaction, types::Json};
use std::collections::HashMap;
use uuid::Uuid;

mod timeline;

#[cfg(test)]
mod test;

/// Postgres adapter shared by channel messages and entity discussions.
#[derive(Clone)]
pub struct PgMessageRepository {
    pool: PgPool,
}

#[derive(Deserialize)]
struct StoredMessage {
    id: Uuid,
    parent_entity_type: String,
    parent_entity_id: String,
    thread_id: Option<Uuid>,
    sender_id: String,
    imported_author: Option<String>,
    triggered_by_user_id: Option<String>,
    content: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    edited_at: Option<chrono::NaiveDateTime>,
    deleted_at: Option<chrono::NaiveDateTime>,
}

fn database_error(error: sqlx::Error) -> MessageError {
    if let sqlx::Error::Database(ref error) = error {
        match error.code().as_deref() {
            Some("23503") => return MessageError::NotFound,
            Some("23505") if error.constraint() == Some("comms_messages_pkey") => {
                return MessageError::Conflict;
            }
            Some("23505") => {
                return MessageError::Invalid("a live discussion already uses this anchor");
            }
            Some("23514") => {
                return MessageError::Invalid("invalid message parent, thread, or anchor");
            }
            _ => {}
        }
    }
    MessageError::Repository(rootcause::Report::new(error).into())
}

/// Legacy channel column kept in step with the parent until the last PR of the stack.
fn channel_column(parent: &MessageParent) -> Option<Uuid> {
    match parent {
        MessageParent::Channel(id) => Some(*id),
        MessageParent::Document(_) => None,
    }
}

/// Email references arrive under several editor aliases; store the canonical one.
fn stored_attachment_type(entity_type: &str) -> &str {
    match MessageReferenceKind::parse(entity_type) {
        Some(MessageReferenceKind::EmailThread) => "email_thread",
        _ => entity_type,
    }
}

impl PgMessageRepository {
    /// Create a repository using the shared MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn hydrate(&self, rows: Vec<Json<StoredMessage>>) -> Result<Vec<Message>, MessageError> {
        let mut connection = self.pool.acquire().await.map_err(database_error)?;
        Self::hydrate_in(&mut connection, rows).await
    }

    async fn hydrate_in(
        connection: &mut sqlx::PgConnection,
        rows: Vec<Json<StoredMessage>>,
    ) -> Result<Vec<Message>, MessageError> {
        let ids: Vec<_> = rows.iter().map(|r| r.id).collect();
        let attachments = sqlx::query!(
            r#"SELECT message_id, id, entity_type, entity_id, width, height, created_at
               FROM comms_attachments WHERE message_id = ANY($1) ORDER BY created_at, id"#,
            &ids,
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(database_error)?;
        let reactions = sqlx::query!(
            r#"SELECT message_id, emoji, array_agg(user_id ORDER BY user_id) AS "users!"
               FROM comms_reactions WHERE message_id = ANY($1) GROUP BY message_id, emoji ORDER BY emoji"#,
            &ids,
        ).fetch_all(&mut *connection).await.map_err(database_error)?;
        let mut attachment_map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
        for a in attachments {
            attachment_map
                .entry(a.message_id)
                .or_default()
                .push(MessageAttachment {
                    id: a.id,
                    entity_type: a.entity_type,
                    entity_id: a.entity_id,
                    width: a.width,
                    height: a.height,
                    created_at: a.created_at,
                });
        }
        let mut reaction_map: HashMap<Uuid, Vec<CountedReaction>> = HashMap::new();
        for r in reactions {
            reaction_map
                .entry(r.message_id)
                .or_default()
                .push(CountedReaction {
                    emoji: r.emoji,
                    users: r.users,
                });
        }
        let string_ids: Vec<String> = ids.iter().map(ToString::to_string).collect();
        let mention_rows = sqlx::query!("SELECT source_entity_id, entity_type, entity_id FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = ANY($1) ORDER BY entity_type, entity_id", &string_ids)
            .fetch_all(&mut *connection).await.map_err(database_error)?;
        let mut mention_map: HashMap<String, Vec<SimpleMention>> = HashMap::new();
        for mention in mention_rows {
            mention_map
                .entry(mention.source_entity_id)
                .or_default()
                .push(SimpleMention {
                    entity_type: mention.entity_type,
                    entity_id: mention.entity_id,
                });
        }
        let bot_ids: Vec<Uuid> = rows
            .iter()
            .filter_map(|r| {
                r.sender_id
                    .strip_prefix("bot|")
                    .and_then(|id| id.parse().ok())
            })
            .collect();
        let bot_rows = sqlx::query!(
            "SELECT id, name, avatar_url FROM bots WHERE id = ANY($1)",
            &bot_ids
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(database_error)?;
        let bots: HashMap<_, _> = bot_rows
            .into_iter()
            .map(|bot| {
                (
                    format!("bot|{}", bot.id),
                    BotSenderProfile {
                        name: bot.name,
                        avatar_url: bot.avatar_url,
                    },
                )
            })
            .collect();
        rows.into_iter()
            .map(|Json(r)| {
                let deleted = r.deleted_at.is_some();
                Ok(Message {
                    id: r.id,
                    parent: MessageParent::parse(&r.parent_entity_type, &r.parent_entity_id)
                        .map_err(|e| MessageError::Repository(rootcause::Report::new(e).into()))?,
                    thread_id: r.thread_id,
                    bot_profile: bots.get(&r.sender_id).cloned().or_else(|| {
                        let id = bot_id::BotIdStr::parse_from_str(&r.sender_id)
                            .ok()?
                            .bot_id();
                        bot_id::system_bot(id).map(|bot| BotSenderProfile {
                            name: bot.name.to_owned(),
                            avatar_url: None,
                        })
                    }),
                    mentions: if deleted {
                        vec![]
                    } else {
                        mention_map.remove(&r.id.to_string()).unwrap_or_default()
                    },
                    sender_id: r
                        .sender_id
                        .try_into()
                        .map_err(|e| MessageError::Repository(rootcause::Report::new(e).into()))?,
                    imported_author: r.imported_author.map(|name| ImportedAuthor { name }),
                    triggered_by: r.triggered_by_user_id,
                    content: if deleted { String::new() } else { r.content },
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    edited_at: r.edited_at.map(|d| d.and_utc()),
                    deleted_at: r.deleted_at.map(|d| d.and_utc()),
                    attachments: if deleted {
                        vec![]
                    } else {
                        attachment_map.remove(&r.id).unwrap_or_default()
                    },
                    reactions: if deleted {
                        vec![]
                    } else {
                        reaction_map.remove(&r.id).unwrap_or_default()
                    },
                })
            })
            .collect()
    }

    async fn require_message_in(
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

    async fn replace_references(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        id: Uuid,
        actor: &str,
        mentions: &[SimpleMention],
        attachments: Option<&[NewAttachment]>,
    ) -> Result<(), MessageError> {
        sqlx::query!("DELETE FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = $1", id.to_string())
            .execute(&mut **tx).await.map_err(database_error)?;
        for mention in mentions {
            sqlx::query!(
                r#"INSERT INTO comms_entity_mentions
                    (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
                    VALUES ($1, 'message', $2, $3, $4, $5) ON CONFLICT DO NOTHING"#,
                macro_uuid::generate_uuid_v7(),
                id.to_string(),
                mention.entity_type,
                mention.entity_id,
                actor,
            )
            .execute(&mut **tx)
            .await
            .map_err(database_error)?;
        }
        if let Some(attachments) = attachments {
            // Preserve stable attachment identities when an editor submits a full
            // replacement set. Delivery compares these IDs to detect additions/removals.
            let existing = sqlx::query!(
                "SELECT id, entity_type, entity_id, width, height FROM comms_attachments WHERE message_id = $1", id
            ).fetch_all(&mut **tx).await.map_err(database_error)?;
            let mut retained = Vec::new();
            let mut added = Vec::new();
            for attachment in attachments {
                let entity_type = stored_attachment_type(&attachment.entity_type);
                if let Some(current) = existing.iter().find(|current| {
                    !retained.contains(&current.id)
                        && current.entity_type == entity_type
                        && current.entity_id == attachment.entity_id
                        && current.width == attachment.width
                        && current.height == attachment.height
                }) {
                    retained.push(current.id);
                } else {
                    added.push((entity_type, attachment));
                }
            }
            sqlx::query!(
                "DELETE FROM comms_attachments WHERE message_id = $1 AND NOT (id = ANY($2))",
                id,
                &retained
            )
            .execute(&mut **tx)
            .await
            .map_err(database_error)?;
            for (entity_type, attachment) in added {
                sqlx::query!(
                    r#"INSERT INTO comms_attachments (id, message_id, channel_id, entity_type, entity_id, width, height)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
                    macro_uuid::generate_uuid_v7(), id, channel_column(parent), entity_type, attachment.entity_id,
                    attachment.width, attachment.height,
                ).execute(&mut **tx).await.map_err(database_error)?;
            }
        }
        Ok(())
    }

    async fn lock_message(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        id: Uuid,
    ) -> Result<String, MessageError> {
        let row = sqlx::query!(
            r#"SELECT m.sender_id FROM comms_messages m
               JOIN comms_message_threads t ON t.root_id = COALESCE(m.thread_id, m.id)
               WHERE m.id = $1 AND m.parent_entity_type = $2 AND m.parent_entity_id = $3
                   AND m.deleted_at IS NULL AND t.deleted_at IS NULL FOR UPDATE OF t, m"#,
            id,
            parent.entity_type(),
            parent.entity_id(),
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(database_error)?
        .ok_or(MessageError::NotFound)?;
        Ok(row.sender_id)
    }

    /// Every root owns one thread row. The AFTER INSERT trigger from the schema
    /// migration creates it for writers that predate this crate; this upsert keeps
    /// the invariant when that trigger is removed and records the anchor either way.
    async fn ensure_thread_in(
        tx: &mut Transaction<'_, Postgres>,
        root_id: Uuid,
        anchor: Option<&NewThreadAnchor>,
    ) -> Result<(), MessageError> {
        let anchor = anchor
            .map(|anchor| serde_json::to_value(anchor.reference()))
            .transpose()
            .map_err(|e| MessageError::Repository(rootcause::Report::new(e).into()))?;
        sqlx::query!(
            r#"INSERT INTO comms_message_threads
                   (root_id, parent_entity_type, parent_entity_id, user_id, anchor, created_at, updated_at)
               SELECT id, parent_entity_type, parent_entity_id, sender_id, $2, created_at, updated_at
               FROM comms_messages WHERE id = $1
               ON CONFLICT (root_id) DO UPDATE SET anchor = EXCLUDED.anchor"#,
            root_id,
            anchor,
        )
        .execute(&mut **tx)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    async fn attach_pdf_anchor_in(
        tx: &mut Transaction<'_, Postgres>,
        command: &CreateMessage,
        root_id: Uuid,
    ) -> Result<(), MessageError> {
        match &command.input.anchor {
            Some(NewThreadAnchor::PdfHighlight { anchor_id }) => {
                let changed = sqlx::query!(
                    r#"UPDATE "PdfHighlightAnchor" SET root_id = $1
                    WHERE uuid = $2 AND "documentId" = $3 AND root_id IS NULL AND "threadId" IS NULL
                        AND "deletedAt" IS NULL"#,
                    root_id,
                    anchor_id,
                    command.parent.entity_id()
                )
                .execute(&mut **tx)
                .await
                .map_err(database_error)?;
                if changed.rows_affected() != 1 {
                    return Err(MessageError::Invalid(
                        "highlight is missing or already threaded",
                    ));
                }
            }
            Some(NewThreadAnchor::PdfPlaceable {
                anchor_id,
                page,
                x_pct,
                y_pct,
                width_pct,
                height_pct,
            }) => {
                sqlx::query!(r#"INSERT INTO "PdfPlaceableCommentAnchor"
                    (uuid, "documentId", owner, root_id, page, "originalPage", "originalIndex",
                     "xPct", "yPct", "widthPct", "heightPct", rotation, "wasEdited", "wasDeleted", "shouldLockOnSave")
                    VALUES ($1, $2, $3, $4, $5, $5, -1, $6, $7, $8, $9, 0, false, false, false)"#,
                    anchor_id, command.parent.entity_id(), command.actor.as_ref(), root_id, page,
                    x_pct, y_pct, width_pct, height_pct).execute(&mut **tx).await.map_err(database_error)?;
            }
            Some(NewThreadAnchor::Markdown { .. }) | None => {}
        }
        Ok(())
    }

    /// Delete a discussion within an existing annotation transaction.
    /// The caller must already have authorized the enclosing annotation operation.
    pub async fn delete_thread_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> Result<ThreadState, MessageError> {
        Self::set_thread_in(tx, parent, root_id, ThreadPatch::default(), true).await
    }

    async fn set_thread(
        &self,
        parent: &MessageParent,
        root_id: Uuid,
        patch: ThreadPatch,
        delete: bool,
    ) -> Result<ThreadState, MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        let state = Self::set_thread_in(&mut tx, parent, root_id, patch, delete).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(state)
    }

    async fn set_thread_in(
        tx: &mut Transaction<'_, Postgres>,
        parent: &MessageParent,
        root_id: Uuid,
        patch: ThreadPatch,
        delete: bool,
    ) -> Result<ThreadState, MessageError> {
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
        let result = sqlx::query_scalar!(
            r#"UPDATE comms_message_threads t SET resolved = COALESCE($2, resolved), updated_at = now(),
                   deleted_at = CASE WHEN $3 THEN now() ELSE deleted_at END,
                   anchor = CASE WHEN $4 OR ($3 AND anchor->>'type' <> 'markdown') THEN NULL ELSE anchor END
               WHERE root_id = $1 RETURNING to_jsonb(t) AS "state!: Json<ThreadState>""#,
            root_id, patch.resolved, delete, patch.detach_anchor,
        ).fetch_one(&mut **tx).await.map_err(database_error)?;
        Ok(result.0)
    }
}

impl MessageRepository for PgMessageRepository {
    async fn replies(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<Vec<Message>, MessageError> {
        let rows = sqlx::query_scalar!(
            r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
               WHERE parent_entity_type = $1 AND parent_entity_id = $2 AND thread_id = $3
                   AND deleted_at IS NULL ORDER BY import_order NULLS LAST, created_at, id"#,
            parent.entity_type(),
            parent.entity_id(),
            root,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        self.hydrate(rows).await
    }

    async fn parent_exists(&self, parent: &MessageParent) -> Result<bool, MessageError> {
        let exists = match parent {
            MessageParent::Document(_) => sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM "Document" WHERE id = $1 AND "deletedAt" IS NULL) AS "exists!""#, parent.entity_id())
                .fetch_one(&self.pool).await,
            MessageParent::Channel(id) => sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM comms_channels WHERE id = $1) AS "exists!""#, id)
                .fetch_one(&self.pool).await,
        };
        exists.map_err(database_error)
    }

    async fn get(&self, parent: &MessageParent, id: Uuid) -> Result<Option<Message>, MessageError> {
        let rows = sqlx::query_scalar!(
            r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
               WHERE id = $1 AND parent_entity_type = $2 AND parent_entity_id = $3"#,
            id,
            parent.entity_type(),
            parent.entity_id(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        Ok(self.hydrate(rows).await?.pop())
    }

    async fn thread(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<Option<ThreadState>, MessageError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT to_jsonb(t) AS "state!: Json<ThreadState>" FROM comms_message_threads t
               WHERE t.root_id = $1 AND t.parent_entity_type = $2 AND t.parent_entity_id = $3"#,
            root,
            parent.entity_type(),
            parent.entity_id(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?
        .map(|state| state.0))
    }

    async fn preceding(
        &self,
        parent: &MessageParent,
        message_id: Uuid,
        limit: u16,
    ) -> Result<Vec<Message>, MessageError> {
        let rows = sqlx::query_scalar!(
            r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>"
               FROM comms_messages m
               JOIN comms_message_threads t ON t.root_id = COALESCE(m.thread_id, m.id)
               JOIN comms_messages target ON target.id = $3
                 AND target.parent_entity_type = $1 AND target.parent_entity_id = $2
               WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                 AND m.deleted_at IS NULL AND t.deleted_at IS NULL
                 AND (m.created_at, m.id) < (target.created_at, target.id)
                 AND ($1 = 'channel' OR COALESCE(m.thread_id, m.id) = COALESCE(target.thread_id, target.id))
               ORDER BY m.created_at DESC, m.id DESC LIMIT $4"#,
            parent.entity_type(),
            parent.entity_id(),
            message_id,
            i64::from(limit.clamp(1, 100)),
        ).fetch_all(&self.pool).await.map_err(database_error)?;
        let mut messages = self.hydrate(rows).await?;
        messages.reverse();
        Ok(messages)
    }

    async fn timeline(
        &self,
        parent: &MessageParent,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        self.read_timeline(parent, query).await
    }

    async fn create(&self, command: CreateMessage) -> Result<Message, MessageError> {
        let id = command
            .input
            .id
            .unwrap_or_else(macro_uuid::generate_uuid_v7);
        let mut tx = self.pool.begin().await.map_err(database_error)?;
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
            r#"INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, channel_id, thread_id,
                    sender_id, triggered_by_user_id, content)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
            id,
            command.parent.entity_type(),
            command.parent.entity_id(),
            channel_column(&command.parent),
            command.input.thread_id,
            command.actor.as_ref(),
            command.triggered_by,
            command.input.content,
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
            &command.parent,
            id,
            command.actor.as_ref(),
            &command.input.mentions,
            Some(&command.input.attachments),
        )
        .await?;
        let message = Self::require_message_in(&mut tx, &command.parent, id).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(message)
    }

    async fn edit(
        &self,
        parent: &MessageParent,
        id: Uuid,
        command: EditMessage,
    ) -> Result<Message, MessageError> {
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
            parent,
            id,
            &actor,
            &command.mentions,
            command.attachments.as_deref(),
        )
        .await?;
        let message = Self::require_message_in(&mut tx, parent, id).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(message)
    }

    async fn delete(&self, parent: &MessageParent, id: Uuid) -> Result<Message, MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::lock_message(&mut tx, parent, id).await?;
        sqlx::query!("UPDATE comms_messages SET content = '', deleted_at = now(), updated_at = now() WHERE id = $1", id)
            .execute(&mut *tx).await.map_err(database_error)?;
        let message = Self::require_message_in(&mut tx, parent, id).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(message)
    }

    async fn react(
        &self,
        parent: &MessageParent,
        id: Uuid,
        user: &str,
        emoji: &str,
        add: bool,
    ) -> Result<Message, MessageError> {
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        Self::lock_message(&mut tx, parent, id).await?;
        if add {
            sqlx::query!("INSERT INTO comms_reactions(message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", id, user, emoji)
                .execute(&mut *tx).await.map_err(database_error)?;
        } else {
            sqlx::query!(
                "DELETE FROM comms_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
                id,
                user,
                emoji
            )
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        }
        let message = Self::require_message_in(&mut tx, parent, id).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(message)
    }

    async fn patch_thread(
        &self,
        parent: &MessageParent,
        root: Uuid,
        patch: ThreadPatch,
    ) -> Result<ThreadState, MessageError> {
        self.set_thread(parent, root, patch, false).await
    }

    async fn delete_thread(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<ThreadState, MessageError> {
        self.set_thread(parent, root, ThreadPatch::default(), true)
            .await
    }

    async fn resolve_legacy(
        &self,
        parent: &MessageParent,
        id: i64,
        is_thread: bool,
    ) -> Result<Option<Uuid>, MessageError> {
        if !matches!(parent, MessageParent::Document(_)) {
            return Ok(None);
        }
        if is_thread {
            sqlx::query_scalar!("SELECT root_id FROM migrated_comment_thread_id WHERE thread_id = $1 AND document_id = $2", id, parent.entity_id())
                .fetch_optional(&self.pool).await.map_err(database_error)
        } else {
            sqlx::query_scalar!("SELECT message_id FROM migrated_comment_id WHERE comment_id = $1 AND document_id = $2", id, parent.entity_id())
                .fetch_optional(&self.pool).await.map_err(database_error)
        }
    }
}
