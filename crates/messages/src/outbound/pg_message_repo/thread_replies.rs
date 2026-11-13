//! A thread's live replies, read one window at a time.
//!
//! Replies sort `import_order NULLS LAST, created_at, id`: imported history
//! first, in its source order, then the replies posted in Macro. That is the
//! order of `idx_comms_messages_thread_order`, but a row comparison cannot
//! step across the NULLs, so every walk reads the imported part and the
//! posted part as two ranges of that index, each stopping at its own limit,
//! and joins them. A part the walk does not reach gets limit 0. A part read
//! from its start or end gets no bound, which the statement replaces with a
//! sentinel through `COALESCE`, so every bound stays an index condition in a
//! generic plan.
use super::*;

#[cfg(test)]
mod test;

/// What one walk away from a cursor reads of each part of the order.
struct Walk<'a> {
    /// Bound in the imported part; none reads the part from its start or end.
    imported_from: Option<&'a ReplyCursor>,
    imported_limit: i64,
    /// Bound in the posted part; none reads the part from its start or end.
    posted_from: Option<&'a ReplyCursor>,
    posted_limit: i64,
}

impl<'a> Walk<'a> {
    /// Up to `limit` replies strictly on `direction`'s side of `cursor`, or
    /// from the end of the thread the walk starts at when there is none.
    fn new(direction: MessageDirection, cursor: Option<&'a ReplyCursor>, limit: i64) -> Self {
        let whole = Self {
            imported_from: None,
            imported_limit: limit,
            posted_from: None,
            posted_limit: limit,
        };
        let Some(cursor) = cursor else {
            return whole;
        };
        match (cursor.import_order.is_some(), direction) {
            // The rest of the imported part, then every posted reply.
            (true, MessageDirection::Newer) => Self {
                imported_from: Some(cursor),
                ..whole
            },
            // The imported replies before the cursor; no posted reply is.
            (true, MessageDirection::Older) => Self {
                imported_from: Some(cursor),
                posted_limit: 0,
                ..whole
            },
            // The posted replies after the cursor; no imported reply is.
            (false, MessageDirection::Newer) => Self {
                imported_limit: 0,
                posted_from: Some(cursor),
                ..whole
            },
            // The posted replies before the cursor, then every imported one.
            (false, MessageDirection::Older) => Self {
                posted_from: Some(cursor),
                ..whole
            },
        }
    }
}

fn position(row: &StoredMessage) -> ReplyCursor {
    ReplyCursor {
        import_order: row.import_order,
        created_at: row.created_at,
        id: row.id,
    }
}

impl PgMessageRepository {
    pub(super) async fn read_thread_replies(
        &self,
        parent: &MessageParent,
        root: Uuid,
        query: &ThreadRepliesQuery,
    ) -> Result<ReplyWindow, MessageError> {
        let limit = usize::from(query.page_size());
        let fetch = i64::from(query.page_size()) + 1;
        // The pool sets no statement timeout, and a walk reads and skips the
        // thread's deleted replies.
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        // A walk must read the thread's order index and stop at its limit.
        // A planner that expects a thread of a few replies reads it through
        // another index and sorts it instead, every reply of a long thread;
        // with sorting off the order index is the only plan left. Hydration
        // sorts, so it runs with sorting back on.
        sqlx::query!("SET LOCAL enable_sort = off")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;

        let (rows, more_older, more_newer) = if let Some(id) = query.around {
            // Fenced so the reply is found by its id alone: beside the
            // parent's columns, a misestimated plan reads the parent's
            // messages to find it.
            let target = sqlx::query_scalar!(
                r#"SELECT target.message AS "message!: Json<StoredMessage>"
                   FROM (
                       SELECT to_jsonb(m) AS message, m.thread_id, m.parent_entity_type,
                           m.parent_entity_id, m.deleted_at
                       FROM comms_messages m
                       WHERE m.id = $3
                       OFFSET 0
                   ) target
                   WHERE target.thread_id = $4
                       AND target.parent_entity_type = $1 AND target.parent_entity_id = $2
                       AND target.deleted_at IS NULL"#,
                parent.entity_type(),
                parent.entity_id(),
                id,
                root,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(database_error)?
            .ok_or(MessageError::NotFound)?;
            let at = position(&target);
            let mut before = Self::walk(
                &mut tx,
                parent,
                root,
                MessageDirection::Older,
                Some(&at),
                fetch,
            )
            .await?;
            let mut after = Self::walk(
                &mut tx,
                parent,
                root,
                MessageDirection::Newer,
                Some(&at),
                fetch,
            )
            .await?;
            // About half the window on each side; a side that runs out
            // leaves its share to the other.
            let mut take_before = before.len().min((limit - 1) / 2);
            let take_after = after.len().min(limit - 1 - take_before);
            take_before = before.len().min(limit - 1 - take_after);
            let more_older = before.len() > take_before;
            let more_newer = after.len() > take_after;
            before.truncate(take_before);
            after.truncate(take_after);
            before.reverse();
            before.push(target);
            before.extend(after);
            (before, more_older, more_newer)
        } else {
            let cursor = query.cursor.as_ref();
            let mut rows =
                Self::walk(&mut tx, parent, root, query.direction, cursor, fetch).await?;
            let more = rows.len() > limit;
            rows.truncate(limit);
            // Behind a cursor there may be replies the caller has not seen,
            // or none left: ask for one past the reply nearest the cursor.
            let behind = match (cursor, rows.first()) {
                (Some(_), Some(nearest)) => {
                    let nearest = position(nearest);
                    let back = match query.direction {
                        MessageDirection::Older => MessageDirection::Newer,
                        MessageDirection::Newer => MessageDirection::Older,
                    };
                    !Self::walk(&mut tx, parent, root, back, Some(&nearest), 1)
                        .await?
                        .is_empty()
                }
                _ => false,
            };
            match query.direction {
                MessageDirection::Older => {
                    rows.reverse();
                    (rows, more, behind)
                }
                MessageDirection::Newer => (rows, behind, more),
            }
        };

        let older_cursor = more_older
            .then(|| rows.first().map(|row| position(row)))
            .flatten();
        let newer_cursor = more_newer
            .then(|| rows.last().map(|row| position(row)))
            .flatten();
        sqlx::query!("SET LOCAL enable_sort = on")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let replies = Self::hydrate_in(&mut tx, rows).await?;
        tx.commit().await.map_err(database_error)?;
        Ok(ReplyWindow {
            replies,
            older_cursor,
            newer_cursor,
        })
    }

    /// Live replies of `root` walking away from `cursor`, nearest first.
    ///
    /// The parent is checked once, on the root: a reply's parent is its
    /// root's (`comms_messages_thread_parent_fkey`), and a parent predicate on
    /// every reply lets the planner intersect the parent's index with the
    /// thread's and sort the result, reading the parent's whole history. The
    /// root is fenced to be found by its id alone, as the `around` reply is.
    async fn walk(
        connection: &mut sqlx::PgConnection,
        parent: &MessageParent,
        root: Uuid,
        direction: MessageDirection,
        cursor: Option<&ReplyCursor>,
        limit: i64,
    ) -> Result<Vec<Json<StoredMessage>>, MessageError> {
        let walk = Walk::new(direction, cursor, limit);
        let imported_order = walk.imported_from.and_then(|from| from.import_order);
        let imported_at = walk.imported_from.map(|from| from.created_at);
        let imported_id = walk.imported_from.map(|from| from.id);
        let posted_at = walk.posted_from.map(|from| from.created_at);
        let posted_id = walk.posted_from.map(|from| from.id);
        let rows = match direction {
            MessageDirection::Newer => {
                sqlx::query_scalar!(
                    r#"SELECT page.message AS "message!: Json<StoredMessage>"
                FROM (
                    (SELECT to_jsonb(m) AS message, m.import_order, m.created_at, m.id
                    FROM comms_messages m
                    WHERE m.thread_id = $3 AND m.import_order IS NOT NULL
                        AND (m.import_order, m.created_at, m.id) > (
                            COALESCE($4::bigint, '-9223372036854775808'::bigint),
                            COALESCE($5::timestamptz, '-infinity'::timestamptz),
                            COALESCE($6::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
                        AND m.deleted_at IS NULL
                    ORDER BY m.import_order, m.created_at, m.id
                    LIMIT $7)
                    UNION ALL
                    (SELECT to_jsonb(m) AS message, m.import_order, m.created_at, m.id
                    FROM comms_messages m
                    WHERE m.thread_id = $3 AND m.import_order IS NULL
                        AND (m.created_at, m.id) > (
                            COALESCE($8::timestamptz, '-infinity'::timestamptz),
                            COALESCE($9::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
                        AND m.deleted_at IS NULL
                    ORDER BY m.import_order, m.created_at, m.id
                    LIMIT $10)
                ) page
                WHERE EXISTS (
                    SELECT 1
                    FROM (
                        SELECT root.parent_entity_type, root.parent_entity_id
                        FROM comms_messages root
                        WHERE root.id = $3
                        OFFSET 0
                    ) root
                    WHERE root.parent_entity_type = $1 AND root.parent_entity_id = $2)
                ORDER BY page.import_order NULLS LAST, page.created_at, page.id
                LIMIT GREATEST($7, $10)"#,
                    parent.entity_type(),
                    parent.entity_id(),
                    root,
                    imported_order,
                    imported_at,
                    imported_id,
                    walk.imported_limit,
                    posted_at,
                    posted_id,
                    walk.posted_limit,
                )
                .fetch_all(&mut *connection)
                .await
            }
            MessageDirection::Older => {
                sqlx::query_scalar!(
                    r#"SELECT page.message AS "message!: Json<StoredMessage>"
                FROM (
                    (SELECT to_jsonb(m) AS message, m.import_order, m.created_at, m.id
                    FROM comms_messages m
                    WHERE m.thread_id = $3 AND m.import_order IS NOT NULL
                        AND (m.import_order, m.created_at, m.id) < (
                            COALESCE($4::bigint, '9223372036854775807'::bigint),
                            COALESCE($5::timestamptz, 'infinity'::timestamptz),
                            COALESCE($6::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                        AND m.deleted_at IS NULL
                    ORDER BY m.import_order DESC, m.created_at DESC, m.id DESC
                    LIMIT $7)
                    UNION ALL
                    (SELECT to_jsonb(m) AS message, m.import_order, m.created_at, m.id
                    FROM comms_messages m
                    WHERE m.thread_id = $3 AND m.import_order IS NULL
                        AND (m.created_at, m.id) < (
                            COALESCE($8::timestamptz, 'infinity'::timestamptz),
                            COALESCE($9::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                        AND m.deleted_at IS NULL
                    ORDER BY m.import_order DESC, m.created_at DESC, m.id DESC
                    LIMIT $10)
                ) page
                WHERE EXISTS (
                    SELECT 1
                    FROM (
                        SELECT root.parent_entity_type, root.parent_entity_id
                        FROM comms_messages root
                        WHERE root.id = $3
                        OFFSET 0
                    ) root
                    WHERE root.parent_entity_type = $1 AND root.parent_entity_id = $2)
                ORDER BY page.import_order DESC NULLS FIRST, page.created_at DESC, page.id DESC
                LIMIT GREATEST($7, $10)"#,
                    parent.entity_type(),
                    parent.entity_id(),
                    root,
                    imported_order,
                    imported_at,
                    imported_id,
                    walk.imported_limit,
                    posted_at,
                    posted_id,
                    walk.posted_limit,
                )
                .fetch_all(&mut *connection)
                .await
            }
        };
        rows.map_err(database_error)
    }
}
