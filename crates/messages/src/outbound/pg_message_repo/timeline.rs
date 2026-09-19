//! Bounded parent timelines using the existing channel keyset and preview behavior.
use super::*;

impl PgMessageRepository {
    pub(super) async fn read_timeline(
        &self,
        parent: &MessageParent,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        let limit = usize::from(query.limit.unwrap_or(50).clamp(1, 100));
        let (mut rows, more_older, more_newer) = if let Some(id) = query.around {
            // Resolve the root once; message content and references are hydrated
            // together with the final page below.
            let anchor = sqlx::query_scalar!(
                r#"SELECT to_jsonb(root) AS "message!: Json<StoredMessage>"
                   FROM comms_messages target
                   JOIN comms_messages root ON root.id = COALESCE(target.thread_id, target.id)
                   JOIN comms_message_threads state ON state.root_id = root.id
                   WHERE target.id = $3 AND target.parent_entity_type = $1 AND target.parent_entity_id = $2
                     AND root.parent_entity_type = $1 AND root.parent_entity_id = $2
                     AND (state.deleted_at IS NULL OR $4)
                     AND (root.deleted_at IS NULL OR $1 = 'document' OR ($4 AND state.deleted_at IS NOT NULL) OR EXISTS (
                         SELECT 1 FROM comms_messages reply
                         WHERE reply.thread_id = root.id AND reply.deleted_at IS NULL))"#,
                parent.entity_type(),
                parent.entity_id(),
                id,
                query.include_deleted_threads,
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(database_error)?
            .ok_or(MessageError::NotFound)?;
            let cursor = MessageCursor {
                created_at: anchor.created_at,
                id: anchor.id,
            };
            let mut before = self
                .older(parent, &query, Some(&cursor), limit as i64 + 1)
                .await?;
            let mut after = self
                .newer(parent, &query, Some(&cursor), limit as i64 + 1)
                .await?;
            let mut take_before = before.len().min((limit - 1) / 2);
            let take_after = after.len().min(limit - 1 - take_before);
            take_before = before.len().min(limit - 1 - take_after);
            let more_older = before.len() > take_before;
            let more_newer = after.len() > take_after;
            before.truncate(take_before);
            after.truncate(take_after);
            before.push(anchor);
            before.extend(after);
            (before, more_older, more_newer)
        } else {
            let mut rows = match query.direction {
                MessageDirection::Older => {
                    self.older(parent, &query, query.cursor.as_ref(), limit as i64 + 1)
                        .await?
                }
                MessageDirection::Newer => {
                    self.newer(parent, &query, query.cursor.as_ref(), limit as i64 + 1)
                        .await?
                }
            };
            let more = rows.len() > limit;
            rows.truncate(limit);
            let has_cursor = query.cursor.is_some();
            let (older, newer) = match query.direction {
                MessageDirection::Older => (more, has_cursor),
                MessageDirection::Newer => (has_cursor, more),
            };
            (rows, older, newer)
        };
        rows.sort_by_key(|row| std::cmp::Reverse((row.created_at, row.id)));
        let next_cursor = more_older
            .then(|| rows.last())
            .flatten()
            .map(|r| MessageCursor {
                created_at: r.created_at,
                id: r.id,
            });
        let previous_cursor = more_newer
            .then(|| rows.first())
            .flatten()
            .map(|r| MessageCursor {
                created_at: r.created_at,
                id: r.id,
            });
        let items = self.hydrate_root_rows(rows).await?;
        Ok(MessagePage {
            items,
            next_cursor,
            previous_cursor,
        })
    }
    /// Hydrate already-selected roots for authorized cross-channel list projections.
    pub async fn hydrate_roots(&self, ids: &[Uuid]) -> Result<Vec<MessageListItem>, MessageError> {
        let rows = sqlx::query_scalar!(
            r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>"
            FROM comms_messages m WHERE id = ANY($1) AND thread_id IS NULL
            ORDER BY array_position($1, id)"#,
            ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(database_error)?;
        self.hydrate_root_rows(rows).await
    }
    async fn hydrate_root_rows(
        &self,
        mut rows: Vec<Json<StoredMessage>>,
    ) -> Result<Vec<MessageListItem>, MessageError> {
        let roots: Vec<_> = rows.iter().map(|r| r.id).collect();
        let states = sqlx::query!(r#"SELECT t.root_id, to_jsonb(t) AS "state!: Json<ThreadState>",
            (SELECT count(*) FROM comms_messages r WHERE r.thread_id = t.root_id AND r.deleted_at IS NULL) AS "reply_count!",
            (SELECT max(created_at) FROM comms_messages r WHERE r.thread_id = t.root_id AND r.deleted_at IS NULL) AS latest_reply_at
            FROM comms_message_threads t WHERE root_id = ANY($1)"#, &roots)
            .fetch_all(&self.pool).await.map_err(database_error)?;
        let previews = sqlx::query_scalar!(r#"SELECT to_jsonb(preview) AS "message!: Json<StoredMessage>"
            FROM unnest($1::uuid[]) root(id) CROSS JOIN LATERAL (
                SELECT r.* FROM comms_messages r WHERE r.thread_id = root.id AND r.deleted_at IS NULL
                ORDER BY r.import_order NULLS LAST, r.created_at, r.id LIMIT 3
            ) preview"#, &roots).fetch_all(&self.pool).await.map_err(database_error)?;
        rows.extend(previews);
        let hydrated = self.hydrate(rows).await?;
        let mut root_messages = HashMap::new();
        let mut replies: HashMap<Uuid, Vec<Message>> = HashMap::new();
        for message in hydrated {
            if let Some(root) = message.thread_id {
                replies.entry(root).or_default().push(message);
            } else {
                root_messages.insert(message.id, message);
            }
        }
        let mut states: HashMap<_, _> = states.into_iter().map(|s| (s.root_id, s)).collect();
        let items = roots
            .into_iter()
            .filter_map(|id| {
                let state = states.remove(&id)?;
                Some(MessageListItem {
                    message: root_messages.remove(&id)?,
                    state: state.state.0,
                    thread: MessageThreadPreview {
                        reply_count: state.reply_count,
                        latest_reply_at: state.latest_reply_at,
                        preview: replies.remove(&id).unwrap_or_default(),
                    },
                })
            })
            .collect();
        Ok(items)
    }
    async fn older(
        &self,
        parent: &MessageParent,
        query: &MessageTimelineQuery,
        cursor: Option<&MessageCursor>,
        limit: i64,
    ) -> Result<Vec<Json<StoredMessage>>, MessageError> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3, $4::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT $5"#,
            parent.entity_type(), parent.entity_id(), cursor.map(|c| c.created_at), cursor.map(|c| c.id), limit,
            if query.ids.is_empty() { None } else { Some(query.ids.as_slice()) }, query.anchored, query.activity_after, query.activity_before, query.include_deleted_threads)
            .fetch_all(&self.pool).await.map_err(database_error)
    }
    async fn newer(
        &self,
        parent: &MessageParent,
        query: &MessageTimelineQuery,
        cursor: Option<&MessageCursor>,
        limit: i64,
    ) -> Result<Vec<Json<StoredMessage>>, MessageError> {
        sqlx::query_scalar!(r#"SELECT to_jsonb(m) AS "message!: Json<StoredMessage>" FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND ($3::timestamptz IS NULL OR (m.created_at, m.id) > ($3, $4::uuid))
            ORDER BY m.created_at ASC, m.id ASC LIMIT $5"#,
            parent.entity_type(), parent.entity_id(), cursor.map(|c| c.created_at), cursor.map(|c| c.id), limit,
            if query.ids.is_empty() { None } else { Some(query.ids.as_slice()) }, query.anchored, query.activity_after, query.activity_before, query.include_deleted_threads)
            .fetch_all(&self.pool).await.map_err(database_error)
    }
}
