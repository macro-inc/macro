use super::*;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};

async fn legacy_database(pool: &PgPool) -> PgConnection {
    let mut connection = pool.acquire().await.unwrap().detach();
    // Seed before either PR migration, using SQLx's isolated test database.
    migrate_to(&mut connection, PREPARE_VERSION - 1)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("legacy_fixture.sql"))
        .execute(&mut connection)
        .await
        .unwrap();
    connection
}

async fn mappings(connection: &mut PgConnection) -> Vec<(i64, Uuid)> {
    sqlx::query_as("SELECT comment_id, message_id FROM migrated_comment_id ORDER BY comment_id")
        .fetch_all(connection)
        .await
        .unwrap()
}

#[sqlx::test(migrations = false)]
async fn channel_read_projections_keep_channel_scoped_index_plans(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Phase::Prepare).await.unwrap();
    run(&mut connection, Phase::Finish).await.unwrap();
    // A small target channel among many unrelated channels and non-UUID documents.
    // Never disable sequential scans: test the planner's actual chosen access path.
    sqlx::raw_sql(
        r#"
        INSERT INTO comms_channels(id, name, channel_type, owner_id)
        SELECT md5('plan-channel-' || n)::uuid, 'Plan fixture', 'private', 'macro|migration@example.com'
        FROM generate_series(1, 200) n;
        INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content, created_at)
        SELECT md5('plan-message-' || c || '-' || n)::uuid, 'channel', md5('plan-channel-' || c)::uuid::text,
            'macro|migration@example.com', 'Unrelated channel', now() - n * interval '1 second'
        FROM generate_series(1, 200) c CROSS JOIN generate_series(1, 100) n;
        INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content)
        SELECT md5('plan-document-' || n)::uuid, 'document', 'legacy-md',
            'macro|migration@example.com', 'Unrelated document'
        FROM generate_series(1, 10000) n;
        ANALYZE comms_messages;
        "#,
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let channel = Uuid::parse_str("01990000-0000-7000-8000-000000000005").unwrap();
    let queries = [
        // Timeline includes tombstone roots with surviving replies, in either direction.
        "SELECT m.id FROM comms_messages m WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = $1::uuid::text AND m.thread_id IS NULL
         AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
         ORDER BY m.created_at DESC, m.id DESC LIMIT 50",
        "SELECT m.id FROM comms_messages m WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = $1::uuid::text AND m.thread_id IS NULL
         AND (m.deleted_at IS NULL OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
         ORDER BY m.created_at ASC, m.id ASC LIMIT 50",
        // Batched latest reads use a parameterized lateral scan for each channel.
        "SELECT latest.id FROM unnest(ARRAY[$1::uuid]) i(channel_id) LEFT JOIN LATERAL (
         SELECT m.id FROM comms_messages m WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = i.channel_id::text AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 1) latest ON true",
        "SELECT latest.id FROM unnest(ARRAY[$1::uuid]) i(channel_id) LEFT JOIN LATERAL (
         SELECT m.id FROM comms_messages m WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = i.channel_id::text AND m.deleted_at IS NULL AND m.thread_id IS NULL
         ORDER BY m.created_at DESC LIMIT 1) latest ON true",
        // Unfiltered reads still need a channel index, including deleted replies.
        "SELECT m.id FROM comms_messages m WHERE m.parent_entity_type = 'channel' AND m.parent_entity_id = $1::uuid::text ORDER BY m.created_at DESC LIMIT 50",
    ];
    for query in queries {
        let plan: Value = sqlx::query_scalar(&format!("EXPLAIN (ANALYZE, FORMAT JSON) {query}"))
            .bind(channel)
            .fetch_one(&mut connection)
            .await
            .unwrap();
        let mut nodes = vec![];
        collect_plan_nodes(&plan[0]["Plan"], &mut nodes);
        assert!(
            nodes.iter().any(|node| {
                node["Index Name"]
                    .as_str()
                    .is_some_and(|name| name.starts_with("comms_messages_parent_"))
                    && node["Index Cond"]
                        .as_str()
                        .is_some_and(|condition| condition.contains("parent_entity_id"))
            }),
            "Channel predicate must be an index condition, not a post-scan filter: {plan:#}"
        );
        assert!(
            nodes
                .iter()
                .all(|node| node["Rows Removed by Filter"].as_u64().unwrap_or(0) < 100),
            "Channel reads must not filter thousands of unrelated messages: {plan:#}"
        );
    }
}

fn collect_plan_nodes<'a>(node: &'a Value, nodes: &mut Vec<&'a Value>) {
    nodes.push(node);
    if let Some(children) = node["Plans"].as_array() {
        for child in children {
            collect_plan_nodes(child, nodes);
        }
    }
}

#[sqlx::test(migrations = false)]
async fn populated_old_schema_survives_both_migrations(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    assert_eq!(
        run(&mut connection, Phase::Prepare).await.unwrap(),
        Outcome::Prepared
    );
    let first = mappings(&mut connection).await;
    assert!(first.iter().all(|(_, id)| id.get_version_num() == 7));
    run(&mut connection, Phase::Prepare).await.unwrap();
    assert_eq!(mappings(&mut connection).await, first);
    assert_eq!(
        run(&mut connection, Phase::Finish).await.unwrap(),
        Outcome::Finished
    );

    let messages = sqlx::query(
        "SELECT id, content, thread_id, imported_author, deleted_at IS NOT NULL AS deleted
         FROM comms_messages WHERE parent_entity_id = 'legacy-md' ORDER BY import_order NULLS LAST",
    )
    .fetch_all(&mut connection)
    .await
    .unwrap();
    assert_eq!(messages.len(), 3); // Deleted root, surviving reply, empty structural root.
    assert_eq!(messages[0].get::<Uuid, _>("id"), first[0].1);
    assert_eq!(
        messages[0].get::<String, _>("imported_author"),
        "Original author"
    );
    assert!(messages[0].get::<bool, _>("deleted"));
    assert_eq!(messages[1].get::<Uuid, _>("thread_id"), first[0].1);
    assert_eq!(messages[1].get::<String, _>("content"), "Surviving reply");
    assert!(messages[2].get::<bool, _>("deleted"));
    let (resolved, anchor): (bool, Value) =
        sqlx::query_as("SELECT resolved, anchor FROM comms_message_threads WHERE root_id = $1")
            .bind(first[0].1)
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert!(resolved);
    assert_eq!(
        anchor,
        json!({"type": "markdown", "mark_id": "01990000-0000-7000-8000-000000000002"})
    );
    let notices: Vec<Value> = sqlx::query_scalar("SELECT metadata FROM notification")
        .fetch_all(&mut connection)
        .await
        .unwrap();
    assert_eq!(notices.len(), 3);
    for notice in notices {
        assert_eq!(notice["commentId"], first[1].1.to_string());
        assert_eq!(notice["threadId"], first[0].1.to_string());
        assert_eq!(notice["commentText"], "Surviving reply");
    }
    let pdf: Value =
        sqlx::query_scalar("SELECT \"modificationData\" FROM \"DocumentInstanceModificationData\"")
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert_eq!(
        pdf["pages"][0]["highlights"][0]["comments"],
        json!([
            {"id": first[2].1, "text": "PDF original"},
            {"id": "external-pdf-id", "text": "External"}
        ])
    );
    let placeable = sqlx::query(
        "SELECT a.\"threadId\", a.\"xPct\", a.\"yPct\", t.anchor
         FROM \"PdfPlaceableCommentAnchor\" a JOIN comms_message_threads t ON t.root_id = a.\"threadId\"",
    ).fetch_one(&mut connection).await.unwrap();
    assert_eq!(placeable.get::<Uuid, _>("threadId"), first[2].1);
    assert_eq!(placeable.get::<f64, _>("xPct"), 0.1);
    assert_eq!(placeable.get::<f64, _>("yPct"), 0.2);
    assert_eq!(
        placeable.get::<Value, _>("anchor"),
        json!({"type": "pdf_placeable", "anchor_id": "01990000-0000-7000-8000-000000000003"})
    );
    let highlight = sqlx::query(
        "SELECT a.\"threadId\", a.text, r.top, t.anchor
         FROM \"PdfHighlightAnchor\" a JOIN comms_message_threads t ON t.root_id = a.\"threadId\"
         JOIN \"PdfHighlightRect\" r ON r.\"pdfHighlightAnchorId\" = a.uuid",
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(highlight.get::<Uuid, _>("threadId"), first[3].1);
    assert_eq!(highlight.get::<String, _>("text"), "Highlighted text");
    assert_eq!(highlight.get::<f64, _>("top"), 0.1);
    assert_eq!(
        highlight.get::<Value, _>("anchor"),
        json!({"type": "pdf_highlight", "anchor_id": "01990000-0000-7000-8000-000000000004"})
    );
    let legacy_gone: bool = sqlx::query_scalar(
        "SELECT to_regclass('\"Comment\"') IS NULL AND to_regclass('\"Thread\"') IS NULL",
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert!(legacy_gone);
    let channel_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM comms_messages WHERE parent_entity_type = 'channel' AND parent_entity_id = $1::uuid::text")
            .bind(generate_uuid_v7())
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert_eq!(channel_count, 0); // Non-UUID legacy document IDs cannot break channel views.
    let channel_messages: Vec<(String, Option<Uuid>)> =
        sqlx::query_as("SELECT content, thread_id FROM comms_messages WHERE parent_entity_type = 'channel' ORDER BY id")
            .fetch_all(&mut connection)
            .await
            .unwrap();
    assert_eq!(
        channel_messages,
        vec![
            ("Channel root".into(), None),
            (
                "Channel reply".into(),
                Some(Uuid::parse_str("01990000-0000-7000-8000-000000000006").unwrap())
            ),
        ]
    );
    let error = sqlx::query(
        "INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, 'email_thread', $2, 'macro|migration@example.com', 'Unsupported')",
    )
    .bind(generate_uuid_v7())
    .bind(generate_uuid_v7().to_string())
    .execute(&mut connection)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("23514")
    );

    // The migrated thread accepts a new reply; existing comments remain editable.
    let reply_id = generate_uuid_v7();
    sqlx::query(
        "INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
         VALUES ($1, 'document', 'legacy-md', $2, 'macro|migration@example.com', 'After cutover')",
    ).bind(reply_id).bind(first[0].1).execute(&mut connection).await.unwrap();
    let edited: String = sqlx::query_scalar(
        "UPDATE comms_messages SET content = 'Edited surviving reply' WHERE id = $1 RETURNING content",
    ).bind(first[1].1).fetch_one(&mut connection).await.unwrap();
    assert_eq!(edited, "Edited surviving reply");
    let reply_root: Uuid = sqlx::query_scalar("SELECT thread_id FROM comms_messages WHERE id = $1")
        .bind(reply_id)
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(reply_root, first[0].1);
    for phase in [Phase::Prepare, Phase::Finish] {
        assert_eq!(
            run(&mut connection, phase).await.unwrap(),
            Outcome::AlreadyCompleted
        );
    }
    assert_eq!(mappings(&mut connection).await, first);
}

#[sqlx::test(migrations = false)]
async fn rejects_changed_roots_and_releases_lock(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Phase::Prepare).await.unwrap();
    sqlx::query("UPDATE \"Comment\" SET \"order\" = 0 WHERE id = 11")
        .execute(&mut connection)
        .await
        .unwrap();
    assert!(
        run(&mut connection, Phase::Finish)
            .await
            .unwrap_err()
            .to_string()
            .contains("Legacy data changed")
    );
    let mut other = pool.acquire().await.unwrap().detach();
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(LOCK_ID)
        .fetch_one(&mut other)
        .await
        .unwrap();
    assert!(acquired);
    other.close().await.unwrap();
    sqlx::query("UPDATE \"Comment\" SET \"order\" = 2 WHERE id = 11")
        .execute(&mut connection)
        .await
        .unwrap();
    run(&mut connection, Phase::Finish).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn failed_final_migration_preserves_legacy_data_and_can_retry(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Phase::Prepare).await.unwrap();
    let first = mappings(&mut connection).await;
    sqlx::query("UPDATE notification SET metadata = jsonb_set(metadata, '{commentId}', '999999')")
        .execute(&mut connection)
        .await
        .unwrap();
    assert!(run(&mut connection, Phase::Finish).await.is_err());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM \"Comment\"")
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(count, 4);
    assert_eq!(mappings(&mut connection).await, first);
    sqlx::query("UPDATE notification SET metadata = jsonb_set(metadata, '{commentId}', '11')")
        .execute(&mut connection)
        .await
        .unwrap();
    run(&mut connection, Phase::Finish).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn rejects_concurrent_runner_and_ambiguous_pdf_anchors(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    let mut other = pool.acquire().await.unwrap().detach();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(LOCK_ID)
        .execute(&mut other)
        .await
        .unwrap();
    assert!(
        run(&mut connection, Phase::Prepare)
            .await
            .unwrap_err()
            .to_string()
            .contains("Another message cutover")
    );
    other.close().await.unwrap();
    sqlx::query("UPDATE \"PdfHighlightAnchor\" SET \"threadId\" = 3")
        .execute(&mut connection)
        .await
        .unwrap();
    assert!(
        run(&mut connection, Phase::Prepare)
            .await
            .unwrap_err()
            .to_string()
            .contains("Multiple PDF anchors")
    );
    sqlx::query("UPDATE \"PdfHighlightAnchor\" SET \"threadId\" = 4")
        .execute(&mut connection)
        .await
        .unwrap();
    run(&mut connection, Phase::Prepare).await.unwrap();
    run(&mut connection, Phase::Finish).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn mappings_cross_batch_boundaries_and_keep_ids_on_retry(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    sqlx::query(
        "INSERT INTO \"Thread\"(id, owner, \"documentId\", resolved)
         SELECT id, 'macro|migration@example.com', 'legacy-md', false FROM generate_series(100, $1) id",
    ).bind(BATCH_SIZE + 100).execute(&mut connection).await.unwrap();
    sqlx::query(
        "INSERT INTO \"Comment\"(id, \"threadId\", owner, text)
         SELECT id, id, 'macro|migration@example.com', 'Batch comment' FROM generate_series(100, $1) id",
    ).bind(BATCH_SIZE + 100).execute(&mut connection).await.unwrap();
    run(&mut connection, Phase::Prepare).await.unwrap();
    let first = mappings(&mut connection).await;
    assert_eq!(first.len(), (BATCH_SIZE + 5) as usize);
    run(&mut connection, Phase::Prepare).await.unwrap();
    assert_eq!(mappings(&mut connection).await, first);
    run(&mut connection, Phase::Finish).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM comms_message_threads")
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(count, BATCH_SIZE + 6); // Includes the original channel thread.
}
