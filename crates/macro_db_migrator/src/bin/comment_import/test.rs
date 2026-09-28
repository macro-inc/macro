use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use summary::Warnings;

const USER: &str = "macro|migration@example.com";

async fn legacy_database(pool: &PgPool) -> PgConnection {
    let mut connection = pool.acquire().await.unwrap().detach();
    sqlx::raw_sql(include_str!("legacy_fixture.sql"))
        .execute(&mut connection)
        .await
        .unwrap();
    connection
}

async fn mappings(connection: &mut PgConnection) -> Vec<(i64, Uuid)> {
    sqlx::query!("SELECT comment_id, message_id FROM migrated_comment_id ORDER BY comment_id")
        .fetch_all(connection)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.comment_id, row.message_id))
        .collect()
}

async fn thread_mappings(connection: &mut PgConnection) -> Vec<(i64, Uuid)> {
    sqlx::query!("SELECT thread_id, root_id FROM migrated_comment_thread_id ORDER BY thread_id")
        .fetch_all(connection)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.thread_id, row.root_id))
        .collect()
}

fn mapped(mappings: &[(i64, Uuid)], legacy_id: i64) -> Uuid {
    mappings
        .iter()
        .find(|(id, _)| *id == legacy_id)
        .map(|(_, uuid)| *uuid)
        .unwrap()
}

#[derive(Debug, PartialEq)]
struct StoredMessage {
    content: String,
    thread_id: Option<Uuid>,
    imported_author: Option<String>,
    deleted: bool,
    import_order: Option<i64>,
}

async fn message(connection: &mut PgConnection, id: Uuid) -> StoredMessage {
    sqlx::query!(
        r#"SELECT content, thread_id, imported_author, deleted_at IS NOT NULL AS "deleted!", import_order
           FROM comms_messages WHERE id = $1"#,
        id
    )
    .map(|row| StoredMessage {
        content: row.content,
        thread_id: row.thread_id,
        imported_author: row.imported_author,
        deleted: row.deleted,
        import_order: row.import_order,
    })
    .fetch_one(connection)
    .await
    .unwrap()
}

#[derive(Debug, PartialEq)]
struct StoredThread {
    resolved: bool,
    anchor: Option<Value>,
    deleted: bool,
}

async fn thread(connection: &mut PgConnection, root_id: Uuid) -> StoredThread {
    sqlx::query!(
        r#"SELECT resolved, anchor, deleted_at IS NOT NULL AS "deleted!"
           FROM comms_message_threads WHERE root_id = $1"#,
        root_id
    )
    .map(|row| StoredThread {
        resolved: row.resolved,
        anchor: row.anchor,
        deleted: row.deleted,
    })
    .fetch_one(connection)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imports_roots_replies_empty_threads_anchors_and_remaps(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    let summary = run(&mut connection, Options::default()).await.unwrap();
    assert_eq!(
        summary,
        Summary {
            documents: 2,
            batches: 1,
            comment_mappings_allocated: 5,
            thread_mappings_allocated: 5,
            // Five comments and one structural root for the empty thread.
            messages_inserted: 6,
            messages_updated: 0,
            messages_tombstoned: 0,
            threads_written: 5,
            threads_tombstoned: 0,
            anchors_linked: 2,
            notifications_remapped: 3,
            pdf_payloads_remapped: 1,
            warnings: Warnings {
                unmapped_notifications: 1,
                unmapped_pdf_comment_ids: 1,
                invalid_mark_ids: 0,
                root_order_drift: 0,
            },
        }
    );
    assert!(!summary.is_noop());
    assert!(
        summary
            .to_string()
            .contains("messages inserted:          6")
    );

    let comments = mappings(&mut connection).await;
    let threads = thread_mappings(&mut connection).await;
    assert_eq!(comments.len(), 5);
    assert_eq!(threads.len(), 5);
    assert!(comments.iter().all(|(_, id)| id.get_version_num() == 7));
    assert!(threads.iter().all(|(_, id)| id.get_version_num() == 7));
    // Roots follow legacy order: the deleted root keeps its identity as the thread root.
    assert_eq!(mapped(&threads, 1), mapped(&comments, 10));
    assert_eq!(mapped(&threads, 3), mapped(&comments, 12));
    assert_eq!(mapped(&threads, 4), mapped(&comments, 13));
    assert_eq!(mapped(&threads, 5), mapped(&comments, 14));

    let root = message(&mut connection, mapped(&comments, 10)).await;
    assert_eq!(
        root,
        StoredMessage {
            content: "Deleted root".into(),
            thread_id: None,
            imported_author: Some("Original author".into()),
            deleted: true,
            import_order: Some(1),
        }
    );
    let reply = message(&mut connection, mapped(&comments, 11)).await;
    assert_eq!(
        reply,
        StoredMessage {
            content: "Surviving reply".into(),
            thread_id: Some(mapped(&threads, 1)),
            imported_author: None,
            deleted: false,
            import_order: Some(2),
        }
    );
    let created_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar!(
        r#"SELECT created_at FROM comms_messages WHERE id = $1"#,
        mapped(&comments, 11)
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(created_at.to_rfc3339(), "2020-01-02T00:00:00+00:00");

    // Markdown mark, resolution, and an unanchored Discussion thread.
    assert_eq!(
        thread(&mut connection, mapped(&threads, 1)).await,
        StoredThread {
            resolved: true,
            anchor: Some(
                json!({"type": "markdown", "mark_id": "01990000-0000-7000-8000-000000000002"})
            ),
            deleted: false,
        }
    );
    assert_eq!(
        thread(&mut connection, mapped(&threads, 5)).await,
        StoredThread {
            resolved: false,
            anchor: None,
            deleted: false,
        }
    );
    // The empty thread is a deleted structural root and a deleted thread.
    let structural = message(&mut connection, mapped(&threads, 2)).await;
    assert!(structural.deleted && structural.content.is_empty() && structural.thread_id.is_none());
    assert!(comments.iter().all(|(_, id)| *id != mapped(&threads, 2)));
    assert!(thread(&mut connection, mapped(&threads, 2)).await.deleted);

    // Notifications point at message ids; the stale one keeps its legacy id.
    let notices: Vec<Value> = sqlx::query_scalar!(
        r#"SELECT metadata AS "metadata!" FROM notification ORDER BY metadata->>'commentText'"#
    )
    .fetch_all(&mut connection)
    .await
    .unwrap();
    assert_eq!(notices.len(), 4);
    assert_eq!(notices[0]["commentId"], 424242);
    for notice in &notices[1..] {
        assert_eq!(notice["commentId"], mapped(&comments, 11).to_string());
        assert_eq!(notice["threadId"], mapped(&threads, 1).to_string());
        assert_eq!(notice["commentText"], "Surviving reply");
    }
    let pdf: Value =
        sqlx::query_scalar!(r#"SELECT "modificationData" FROM "DocumentInstanceModificationData""#)
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert_eq!(
        pdf["pages"][0]["highlights"][0]["comments"],
        json!([
            {"id": mapped(&comments, 12), "text": "PDF original"},
            {"id": "999", "text": "Stale"},
            {"id": "external-pdf-id", "text": "External"}
        ])
    );

    // PDF anchors keep their legacy thread id and gain the root; thread state points back.
    let placeable = sqlx::query!(
        r#"SELECT a."threadId" AS thread_id, a.root_id, a."xPct" AS x_pct, t.anchor
           FROM "PdfPlaceableCommentAnchor" a JOIN comms_message_threads t ON t.root_id = a.root_id"#
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(placeable.thread_id, Some(3));
    assert_eq!(placeable.root_id, Some(mapped(&threads, 3)));
    assert_eq!(placeable.x_pct, 0.1);
    assert_eq!(
        placeable.anchor,
        Some(json!({"type": "pdf_placeable", "anchor_id": "01990000-0000-7000-8000-000000000003"}))
    );
    let highlight = sqlx::query!(
        r#"SELECT a."threadId" AS thread_id, a.root_id, a.text, r.top, t.anchor
           FROM "PdfHighlightAnchor" a JOIN comms_message_threads t ON t.root_id = a.root_id
           JOIN "PdfHighlightRect" r ON r."pdfHighlightAnchorId" = a.uuid"#
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(highlight.thread_id, Some(4));
    assert_eq!(highlight.root_id, Some(mapped(&threads, 4)));
    assert_eq!(highlight.text, "Highlighted text");
    assert_eq!(highlight.top, 0.1);
    assert_eq!(
        highlight.anchor,
        Some(json!({"type": "pdf_highlight", "anchor_id": "01990000-0000-7000-8000-000000000004"}))
    );

    // Legacy rows are untouched and channel messages are not affected.
    let legacy_count: i64 = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM "Comment""#)
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(legacy_count, 5);
    let channel_messages: Vec<(String, Option<Uuid>)> = sqlx::query!(
        "SELECT content, thread_id FROM comms_messages WHERE parent_entity_type = 'channel' ORDER BY id"
    )
    .fetch_all(&mut connection)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.content, row.thread_id))
    .collect();
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

    // The imported thread accepts new replies and edits through the message store.
    let reply_id = generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
         VALUES ($1, 'document', 'legacy-md', $2, $3, 'After import')",
        reply_id,
        mapped(&threads, 1),
        USER
    )
    .execute(&mut connection)
    .await
    .unwrap();

    // A second run finds nothing to do and keeps every id.
    let again = run(&mut connection, Options::default()).await.unwrap();
    assert!(again.is_noop(), "{again:?}");
    assert_eq!(again.documents, 2);
    assert!(again.to_string().starts_with("Nothing to import"));
    assert_eq!(again.warnings.unmapped_notifications, 1);
    assert_eq!(mappings(&mut connection).await, comments);
    assert_eq!(thread_mappings(&mut connection).await, threads);
    assert_eq!(
        message(&mut connection, reply_id).await.content,
        "After import"
    );

    let pending = check(&mut connection).await.unwrap();
    assert_eq!(
        pending,
        Pending {
            comments_without_mapping: 0,
            threads_without_mapping: 0,
            documents_with_legacy_comments: 2,
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delta_runs_carry_new_edited_and_deleted_legacy_comments(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Options::default()).await.unwrap();
    let comments = mappings(&mut connection).await;
    let threads = thread_mappings(&mut connection).await;

    // Legacy writers keep going: a new reply, an edit, a comment deletion without
    // an updatedAt bump, a thread deletion, and a comment added to the empty thread.
    sqlx::raw_sql(
        r#"
        INSERT INTO "Comment"(id, "threadId", owner, text, "createdAt", "updatedAt")
        VALUES (15, 1, 'macro|migration@example.com', 'Late reply', '2020-02-01', '2020-02-01');
        UPDATE "Thread" SET "updatedAt" = '2020-02-01' WHERE id = 1;
        UPDATE "Comment" SET text = 'Surviving reply, edited', "updatedAt" = '2020-02-02' WHERE id = 11;
        UPDATE "Comment" SET "deletedAt" = '2020-02-03' WHERE id = 14;
        UPDATE "Thread" SET "deletedAt" = '2020-02-04' WHERE id = 4;
        UPDATE "Comment" SET "deletedAt" = '2020-02-04' WHERE "threadId" = 4;
        INSERT INTO "Comment"(id, "threadId", owner, text, "createdAt", "updatedAt")
        VALUES (16, 2, 'macro|migration@example.com', 'Revived discussion', '2020-02-05', '2020-02-05');
        UPDATE "Thread" SET "updatedAt" = '2020-02-05' WHERE id = 2;
        "#,
    )
    .execute(&mut connection)
    .await
    .unwrap();

    let delta = run(&mut connection, Options::default()).await.unwrap();
    assert_eq!(delta.comment_mappings_allocated, 2);
    assert_eq!(delta.thread_mappings_allocated, 0);
    assert_eq!(delta.messages_inserted, 2);
    // Edited reply, deleted comment 14, deleted comment 13. The revived thread's
    // structural root keeps its tombstone untouched.
    assert_eq!(delta.messages_updated, 3);
    assert_eq!(delta.messages_tombstoned, 0);
    // Thread 1 (updated_at), thread 4 (deleted), thread 2 (revived) changed.
    assert_eq!(delta.threads_written, 3);
    assert_eq!(delta.warnings.root_order_drift, 1);

    let after = mappings(&mut connection).await;
    assert_eq!(after.len(), 7);
    assert!(after.starts_with(&comments));
    assert_eq!(thread_mappings(&mut connection).await, threads);

    let late = message(&mut connection, mapped(&after, 15)).await;
    assert_eq!(late.content, "Late reply");
    assert_eq!(late.thread_id, Some(mapped(&threads, 1)));
    assert_eq!(late.import_order, Some(3));
    let edited = message(&mut connection, mapped(&after, 11)).await;
    assert_eq!(edited.content, "Surviving reply, edited");
    assert!(!edited.deleted);
    let edited_at: Option<chrono::NaiveDateTime> = sqlx::query_scalar!(
        "SELECT edited_at FROM comms_messages WHERE id = $1",
        mapped(&after, 11)
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(edited_at.unwrap().to_string(), "2020-02-02 00:00:00");
    assert!(message(&mut connection, mapped(&after, 14)).await.deleted);
    assert!(message(&mut connection, mapped(&after, 13)).await.deleted);
    assert!(thread(&mut connection, mapped(&threads, 4)).await.deleted);
    // The highlight keeps its root so the deleted discussion stays addressable.
    let highlight_root: Option<Uuid> =
        sqlx::query_scalar!(r#"SELECT root_id FROM "PdfHighlightAnchor""#)
            .fetch_one(&mut connection)
            .await
            .unwrap();
    assert_eq!(highlight_root, Some(mapped(&threads, 4)));

    // The formerly empty thread is live again: structural root stays a tombstone,
    // the new comment is a reply to it.
    let revived = thread(&mut connection, mapped(&threads, 2)).await;
    assert!(!revived.deleted);
    let revived_comment = message(&mut connection, mapped(&after, 16)).await;
    assert_eq!(revived_comment.thread_id, Some(mapped(&threads, 2)));
    assert!(message(&mut connection, mapped(&threads, 2)).await.deleted);

    let settled = run(&mut connection, Options::default()).await.unwrap();
    assert!(settled.is_noop(), "{settled:?}");
    assert_eq!(settled.warnings.root_order_drift, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn newer_writes_through_the_message_store_are_never_reverted(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Options::default()).await.unwrap();
    let comments = mappings(&mut connection).await;
    let threads = thread_mappings(&mut connection).await;
    let reply = mapped(&comments, 11);

    // The new UI edits the imported reply and resolves the Discussion thread
    // after the legacy rows went stale.
    sqlx::query!(
        "UPDATE comms_messages SET content = 'Edited in the new UI', updated_at = now(), edited_at = now() WHERE id = $1",
        reply
    )
    .execute(&mut connection)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE comms_message_threads SET resolved = true, updated_at = now() WHERE root_id = $1",
        mapped(&threads, 5)
    )
    .execute(&mut connection)
    .await
    .unwrap();

    let rerun = run(&mut connection, Options::default()).await.unwrap();
    assert!(rerun.is_noop(), "{rerun:?}");
    assert_eq!(
        message(&mut connection, reply).await.content,
        "Edited in the new UI"
    );
    assert!(thread(&mut connection, mapped(&threads, 5)).await.resolved);

    // A legacy edit that is newer than the stored row still wins.
    sqlx::query!(
        r#"UPDATE "Comment" SET text = 'Edited again in legacy', "updatedAt" = now() + interval '1 hour' WHERE id = 11"#
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let legacy_wins = run(&mut connection, Options::default()).await.unwrap();
    assert_eq!(legacy_wins.messages_updated, 1);
    assert_eq!(
        message(&mut connection, reply).await.content,
        "Edited again in legacy"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removed_legacy_rows_become_tombstones(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Options::default()).await.unwrap();
    let comments = mappings(&mut connection).await;
    let threads = thread_mappings(&mut connection).await;
    sqlx::raw_sql(
        r#"
        DELETE FROM "Comment" WHERE id = 14;
        DELETE FROM "Thread" WHERE id = 3;
        "#,
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let summary = run(&mut connection, Options::default()).await.unwrap();
    // Comment 14 alone, then thread 3 with its single comment.
    assert_eq!(summary.messages_tombstoned, 2);
    assert_eq!(summary.threads_tombstoned, 1);
    assert!(
        message(&mut connection, mapped(&comments, 14))
            .await
            .deleted
    );
    assert!(
        message(&mut connection, mapped(&comments, 12))
            .await
            .deleted
    );
    assert!(thread(&mut connection, mapped(&threads, 3)).await.deleted);
    assert_eq!(mappings(&mut connection).await, comments);
    assert!(
        run(&mut connection, Options::default())
            .await
            .unwrap()
            .is_noop()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejects_concurrent_runner_ambiguous_anchors_and_duplicate_marks(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    let mut other = pool.acquire().await.unwrap().detach();
    sqlx::query!("SELECT pg_advisory_lock($1)", LOCK_ID)
        .execute(&mut other)
        .await
        .unwrap();
    assert!(
        run(&mut connection, Options::default())
            .await
            .unwrap_err()
            .to_string()
            .contains("Another comment import")
    );
    release_import_lock(&mut other).await;
    other.close().await.unwrap();

    sqlx::query!(r#"UPDATE "PdfHighlightAnchor" SET "threadId" = 3"#)
        .execute(&mut connection)
        .await
        .unwrap();
    assert!(
        run(&mut connection, Options::default())
            .await
            .unwrap_err()
            .to_string()
            .contains("Multiple PDF anchors")
    );
    sqlx::query!(r#"UPDATE "PdfHighlightAnchor" SET "threadId" = 4"#)
        .execute(&mut connection)
        .await
        .unwrap();

    sqlx::query!(
        r#"UPDATE "Thread" SET metadata = '{"markId":"01990000-0000-7000-8000-000000000002"}' WHERE id = 5"#
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let error = run(&mut connection, Options::default())
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("share the same Markdown mark"), "{error}");
    assert!(error.contains("[1, 5]"), "{error}");
    assert!(mappings(&mut connection).await.is_empty());

    // The lock is released after a failed preflight.
    let mut probe = other_connection(&pool).await;
    let acquired: bool =
        sqlx::query_scalar!(r#"SELECT pg_try_advisory_lock($1) AS "acquired!""#, LOCK_ID)
            .fetch_one(&mut probe)
            .await
            .unwrap();
    assert!(acquired);
    release_import_lock(&mut probe).await;
    probe.close().await.unwrap();

    sqlx::query!(r#"UPDATE "Thread" SET metadata = '{"markId":"not-a-mark"}' WHERE id = 5"#)
        .execute(&mut connection)
        .await
        .unwrap();
    let summary = run(&mut connection, Options::default()).await.unwrap();
    assert_eq!(summary.warnings.invalid_mark_ids, 1);
    let threads = thread_mappings(&mut connection).await;
    assert_eq!(
        thread(&mut connection, mapped(&threads, 5)).await.anchor,
        None
    );
}

async fn other_connection(pool: &PgPool) -> PgConnection {
    pool.acquire().await.unwrap().detach()
}

async fn release_import_lock(connection: &mut PgConnection) {
    // Closing the client does not wait for PostgreSQL to release session locks.
    // Await an explicit unlock before another connection tries to run the import.
    assert!(
        sqlx::query_scalar!(r#"SELECT pg_advisory_unlock($1) AS "released!""#, LOCK_ID)
            .fetch_one(connection)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_batch_rolls_back_and_can_retry(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    // A discussion created through the message store already owns the mark of
    // legacy thread 1, which the preflight cannot see.
    let conflicting_root = generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, 'document', 'legacy-md', $2, 'New store discussion')",
        conflicting_root,
        USER
    )
    .execute(&mut connection)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE comms_message_threads SET anchor = '{"type":"markdown","mark_id":"01990000-0000-7000-8000-000000000002"}' WHERE root_id = $1"#,
        conflicting_root
    )
    .execute(&mut connection)
    .await
    .unwrap();

    let error = run(&mut connection, Options::default()).await.unwrap_err();
    assert!(
        error
            .to_string()
            .contains("idx_comms_message_threads_markdown_mark"),
        "{error}"
    );
    assert!(mappings(&mut connection).await.is_empty());
    assert!(thread_mappings(&mut connection).await.is_empty());
    let imported: i64 = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_messages WHERE parent_entity_type = 'document'"#
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(imported, 1);
    let legacy_count: i64 = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM "Comment""#)
        .fetch_one(&mut connection)
        .await
        .unwrap();
    assert_eq!(legacy_count, 5);

    sqlx::query!(
        "UPDATE comms_message_threads SET anchor = NULL WHERE root_id = $1",
        conflicting_root
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let summary = run(&mut connection, Options::default()).await.unwrap();
    assert_eq!(summary.comment_mappings_allocated, 5);
    assert_eq!(summary.thread_mappings_allocated, 5);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mappings_cross_batch_boundaries_and_keep_ids_on_retry(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    let extra = MAPPING_CHUNK as i64 + 100;
    sqlx::query!(
        r#"INSERT INTO "Thread"(id, owner, "documentId", resolved)
           SELECT id, $1, 'legacy-md', false FROM generate_series(100, $2::bigint) id"#,
        USER,
        extra
    )
    .execute(&mut connection)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Comment"(id, "threadId", owner, text)
           SELECT id, id, $1, 'Batch comment' FROM generate_series(100, $2::bigint) id"#,
        USER,
        extra
    )
    .execute(&mut connection)
    .await
    .unwrap();
    let options = Options {
        documents_per_batch: 1,
    };
    let summary = run(&mut connection, options).await.unwrap();
    assert_eq!(summary.batches, 2);
    assert_eq!(summary.documents, 2);
    assert_eq!(summary.comment_mappings_allocated, MAPPING_CHUNK as u64 + 6);
    let first = mappings(&mut connection).await;
    assert_eq!(first.len(), MAPPING_CHUNK + 6);
    assert!(run(&mut connection, options).await.unwrap().is_noop());
    assert_eq!(mappings(&mut connection).await, first);
    let count: i64 = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_message_threads WHERE parent_entity_type = 'document'"#
    )
    .fetch_one(&mut connection)
    .await
    .unwrap();
    assert_eq!(count, MAPPING_CHUNK as i64 + 6);
}

#[test]
fn pdf_comment_ids_are_remapped_at_any_depth_and_unmapped_ids_are_counted() {
    let mapped_id = Uuid::from_u128(12);
    let mappings = HashMap::from([(12_i64, mapped_id)]);
    let mut payload = json!({
        "placeables": [{"payload": {"comments": [
            {"id": "12", "content": "a"},
            {"id": "13", "content": "b"},
            {"id": "wrapper", "comments": [{"id": 12}]}
        ]}}],
        "highlights": {"1": [{"thread": {"comments": [{"id": 12}, {"id": "external"}, "not an object"]}}]},
        "comments": "not an array",
    });
    let stats = remap_comment_ids(&mut payload, &mappings);
    // Two top-level 12s plus the 12 nested inside the "wrapper" comment.
    assert_eq!(
        stats,
        RemapStats {
            remapped: 3,
            unmapped: 1,
        }
    );
    assert_eq!(
        payload["placeables"][0]["payload"]["comments"][2]["comments"][0]["id"],
        mapped_id.to_string()
    );
    assert_eq!(
        payload["placeables"][0]["payload"]["comments"][0]["id"],
        mapped_id.to_string()
    );
    assert_eq!(
        payload["placeables"][0]["payload"]["comments"][1]["id"],
        "13"
    );
    assert_eq!(
        payload["highlights"]["1"][0]["thread"]["comments"][0]["id"],
        mapped_id.to_string()
    );
    assert_eq!(
        payload["highlights"]["1"][0]["thread"]["comments"][1]["id"],
        "external"
    );
    // A second pass rewrites nothing and still reports the id that has no mapping.
    assert_eq!(
        remap_comment_ids(&mut payload, &mappings),
        RemapStats {
            remapped: 0,
            unmapped: 1,
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_read_projections_keep_channel_scoped_index_plans(pool: PgPool) {
    let mut connection = legacy_database(&pool).await;
    run(&mut connection, Options::default()).await.unwrap();
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
        let plan = explain(&mut connection, query, channel).await;
        let mut nodes = vec![];
        collect_plan_nodes(&plan[0]["Plan"], &mut nodes);
        assert!(
            nodes.iter().any(|node| {
                node["Index Name"]
                    .as_str()
                    .is_some_and(|name| name.starts_with("idx_comms_messages_parent_"))
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

#[expect(
    clippy::disallowed_methods,
    reason = "EXPLAIN over test-provided SQL cannot be checked at compile time"
)]
async fn explain(connection: &mut PgConnection, query: &str, channel: Uuid) -> Value {
    sqlx::query_scalar(&format!("EXPLAIN (ANALYZE, FORMAT JSON) {query}"))
        .bind(channel)
        .fetch_one(connection)
        .await
        .unwrap()
}

fn collect_plan_nodes<'a>(node: &'a Value, nodes: &mut Vec<&'a Value>) {
    nodes.push(node);
    if let Some(children) = node["Plans"].as_array() {
        for child in children {
            collect_plan_nodes(child, nodes);
        }
    }
}
