use super::*;

async fn legacy_roots(
    pool: &PgPool,
    parent: &MessageParent,
    query: &MessageTimelineQuery,
) -> Vec<Uuid> {
    let cursor = query.cursor.as_ref();
    let limit = i64::from(query.limit.unwrap_or(50).clamp(1, 100));
    let ids = if query.ids.is_empty() {
        None
    } else {
        Some(query.ids.as_slice())
    };
    match query.direction {
        MessageDirection::Older => sqlx::query_file_scalar!(
            "src/outbound/pg_message_repo/test/legacy_older.sql",
            parent.entity_type(),
            parent.entity_id(),
            cursor.map(|c| c.created_at),
            cursor.map(|c| c.id),
            limit,
            ids,
            query.anchored,
            query.activity_after,
            query.activity_before,
            query.include_deleted_threads,
        )
        .fetch_all(pool)
        .await
        .unwrap(),
        MessageDirection::Newer => sqlx::query_file_scalar!(
            "src/outbound/pg_message_repo/test/legacy_newer.sql",
            parent.entity_type(),
            parent.entity_id(),
            cursor.map(|c| c.created_at),
            cursor.map(|c| c.id),
            limit,
            ids,
            query.anchored,
            query.activity_after,
            query.activity_before,
            query.include_deleted_threads,
        )
        .fetch_all(pool)
        .await
        .unwrap(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn timeline_keyset_rewrite_matches_previous_sql_selection(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let channel_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels(id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel_id,
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let timestamp = DateTime::parse_from_rfc3339("2026-01-01T00:00:00.123456Z")
        .unwrap()
        .with_timezone(&Utc);
    for parent in [
        MessageParent::Channel(channel_id),
        MessageParent::parse("document", "message-doc-a").unwrap(),
    ] {
        let mut roots = Vec::new();
        for index in 0..9 {
            let mut input = command("message-doc-a", None, "root");
            input.parent = parent.clone();
            let mut root = repo.create(input).await.unwrap();
            root.created_at = timestamp + chrono::Duration::seconds(index / 3);
            sqlx::query!(
                "UPDATE comms_messages SET created_at = $2 WHERE id = $1",
                root.id,
                root.created_at
            )
            .execute(&pool)
            .await
            .unwrap();
            if index == 1 {
                let mut reply = command("message-doc-a", Some(root.id), "keep tombstone visible");
                reply.parent = parent.clone();
                repo.create(reply).await.unwrap();
                repo.delete(&parent, root.id).await.unwrap();
            }
            if index == 3 {
                repo.delete(&parent, root.id).await.unwrap();
            }
            if index == 5 {
                repo.delete_thread(&parent, root.id).await.unwrap();
            }
            roots.push(root);
        }
        for direction in [MessageDirection::Older, MessageDirection::Newer] {
            for cursor in std::iter::once(None).chain(roots.iter().map(|root| {
                Some(MessageCursor {
                    created_at: root.created_at,
                    id: root.id,
                })
            })) {
                for include_deleted_threads in [false, true] {
                    for limit in [1, 3, 100] {
                        let query = MessageTimelineQuery {
                            cursor: cursor.clone(),
                            direction,
                            include_deleted_threads,
                            limit: Some(limit),
                            ..Default::default()
                        };
                        let mut more_query = query.clone();
                        more_query.limit = Some(limit.saturating_add(1));
                        let mut expected = legacy_roots(&pool, &parent, &more_query).await;
                        let more = expected.len() > usize::from(limit);
                        expected.truncate(usize::from(limit));
                        if direction == MessageDirection::Newer {
                            expected.reverse();
                        }
                        let page = repo.timeline(&parent, query).await.unwrap();
                        assert_eq!(
                            page.items
                                .iter()
                                .map(|item| item.message.id)
                                .collect::<Vec<_>>(),
                            expected
                        );
                        let (older, newer) = match direction {
                            MessageDirection::Older => (more, cursor.is_some()),
                            MessageDirection::Newer => (cursor.is_some(), more),
                        };
                        assert_eq!(page.next_cursor.is_some(), older && !expected.is_empty());
                        assert_eq!(
                            page.previous_cursor.is_some(),
                            newer && !expected.is_empty()
                        );
                    }
                }
            }
        }
    }
}
