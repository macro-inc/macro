use comms_db_client::messages::create_message::{CreateMessageOptions, create_message};
use comms_db_client::messages::get_messages::get_channel_messages;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const CH1: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const CH3: Uuid = Uuid::from_u128(0x33333333_3333_3333_3333_333333333333);
const USER1: &str = "macro|user1@test.com";
const USER2: &str = "macro|user2@test.com";
const DOC: &str = "doc-1";
const OTHER_DOC: &str = "doc-2";

#[derive(Debug, PartialEq, sqlx::FromRow)]
struct ParentColumns {
    channel_id: Option<Uuid>,
    parent_entity_type: String,
    parent_entity_id: String,
}

fn channel_parent(channel_id: Uuid) -> ParentColumns {
    ParentColumns {
        channel_id: Some(channel_id),
        parent_entity_type: "channel".to_owned(),
        parent_entity_id: channel_id.to_string(),
    }
}

async fn parent_columns(pool: &Pool<Postgres>, id: Uuid) -> anyhow::Result<ParentColumns> {
    Ok(sqlx::query_as(
        "SELECT channel_id, parent_entity_type, parent_entity_id FROM comms_messages WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await?)
}

async fn thread_rows(pool: &Pool<Postgres>, root_id: Uuid) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT count(*) FROM comms_message_threads WHERE root_id = $1")
            .bind(root_id)
            .fetch_one(pool)
            .await?,
    )
}

async fn insert_channel_root(pool: &Pool<Postgres>, channel_id: Uuid) -> anyhow::Result<Uuid> {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        "INSERT INTO comms_messages (id, channel_id, sender_id, content) VALUES ($1, $2, $3, 'root')",
    )
    .bind(id)
    .bind(channel_id)
    .bind(USER1)
    .execute(pool)
    .await?;
    Ok(id)
}

async fn insert_document_root(pool: &Pool<Postgres>, document_id: &str) -> anyhow::Result<Uuid> {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, 'document', $2, $3, 'root')",
    )
    .bind(id)
    .bind(document_id)
    .bind(USER1)
    .execute(pool)
    .await?;
    Ok(id)
}

async fn set_markdown_anchor(
    pool: &Pool<Postgres>,
    root_id: Uuid,
    mark_id: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE comms_message_threads
         SET anchor = jsonb_build_object('type', 'markdown', 'mark_id', $2::text)
         WHERE root_id = $1",
    )
    .bind(root_id)
    .bind(mark_id)
    .execute(pool)
    .await?;
    Ok(())
}

fn constraint_name(err: &sqlx::Error) -> Option<&str> {
    err.as_database_error().and_then(|e| e.constraint())
}

fn error_code(err: &sqlx::Error) -> Option<String> {
    err.as_database_error()
        .and_then(|e| e.code())
        .map(|code| code.into_owned())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn old_style_channel_insert_gets_parent_columns_and_thread_row(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let id = insert_channel_root(&pool, CH1).await?;

    assert_eq!(parent_columns(&pool, id).await?, channel_parent(CH1));

    let (parent_type, parent_id, user_id, resolved, deleted_at): (
        String,
        String,
        String,
        bool,
        Option<chrono::DateTime<chrono::Utc>>,
    ) = sqlx::query_as(
        "SELECT parent_entity_type, parent_entity_id, user_id, resolved, deleted_at
         FROM comms_message_threads WHERE root_id = $1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(parent_type, "channel");
    assert_eq!(parent_id, CH1.to_string());
    assert_eq!(user_id, USER1);
    assert!(!resolved);
    assert_eq!(deleted_at, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn parent_only_channel_insert_gets_channel_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, 'channel', $2, $3, 'hi')",
    )
    .bind(id)
    .bind(CH3.to_string())
    .bind(USER1)
    .execute(&pool)
    .await?;

    assert_eq!(parent_columns(&pool, id).await?, channel_parent(CH3));
    assert_eq!(thread_rows(&pool, id).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn document_root_without_channel_inserts_and_gets_thread_row(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let root_id = insert_document_root(&pool, DOC).await?;

    assert_eq!(
        parent_columns(&pool, root_id).await?,
        ParentColumns {
            channel_id: None,
            parent_entity_type: "document".to_owned(),
            parent_entity_id: DOC.to_owned(),
        }
    );
    assert_eq!(thread_rows(&pool, root_id).await?, 1);

    let reply_id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
         VALUES ($1, 'document', $2, $3, $4, 'reply')",
    )
    .bind(reply_id)
    .bind(DOC)
    .bind(root_id)
    .bind(USER2)
    .execute(&pool)
    .await?;
    assert_eq!(thread_rows(&pool, reply_id).await?, 0);

    sqlx::query("DELETE FROM comms_messages WHERE id = $1")
        .bind(root_id)
        .execute(&pool)
        .await?;
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM comms_messages WHERE parent_entity_id = $1")
            .bind(DOC)
            .fetch_one(&pool)
            .await?;
    assert_eq!(remaining, 0);
    assert_eq!(thread_rows(&pool, root_id).await?, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn reply_with_different_parent_than_root_is_rejected(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let doc_root = insert_document_root(&pool, DOC).await?;
    let err = sqlx::query(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
         VALUES ($1, 'document', $2, $3, $4, 'reply')",
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(OTHER_DOC)
    .bind(doc_root)
    .bind(USER2)
    .execute(&pool)
    .await
    .expect_err("reply on another document must not reference this root");
    assert_eq!(
        constraint_name(&err),
        Some("comms_messages_thread_parent_fkey")
    );

    let channel_root = insert_channel_root(&pool, CH1).await?;
    let err = sqlx::query(
        "INSERT INTO comms_messages (id, channel_id, thread_id, sender_id, content)
         VALUES ($1, $2, $3, $4, 'reply')",
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(CH3)
    .bind(channel_root)
    .bind(USER2)
    .execute(&pool)
    .await
    .expect_err("reply in another channel must not reference this root");
    assert_eq!(
        constraint_name(&err),
        Some("comms_messages_thread_parent_fkey")
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn disagreeing_channel_id_and_parent_are_rejected(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let err = sqlx::query(
        "INSERT INTO comms_messages (id, channel_id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, $2, 'channel', $3, $4, 'hi')",
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(CH1)
    .bind(CH3.to_string())
    .bind(USER1)
    .execute(&pool)
    .await
    .expect_err("channel_id and parent_entity_id must agree");
    assert_eq!(error_code(&err).as_deref(), Some("23514"));

    let err = sqlx::query(
        "INSERT INTO comms_messages (id, channel_id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, $2, 'document', $3, $4, 'hi')",
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(CH1)
    .bind(DOC)
    .bind(USER1)
    .execute(&pool)
    .await
    .expect_err("a document message cannot carry a channel_id");
    assert_eq!(
        constraint_name(&err),
        Some("comms_messages_channel_parent_check")
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn anchor_on_channel_root_is_rejected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let channel_root = insert_channel_root(&pool, CH1).await?;
    let err = set_markdown_anchor(&pool, channel_root, "mark-1")
        .await
        .expect_err("channel threads cannot be anchored");
    assert_eq!(
        constraint_name(&err),
        Some("comms_message_threads_anchor_parent_check")
    );

    let doc_root = insert_document_root(&pool, DOC).await?;
    let err = sqlx::query(
        r#"UPDATE comms_message_threads SET anchor = '{"type": "unknown"}' WHERE root_id = $1"#,
    )
    .bind(doc_root)
    .execute(&pool)
    .await
    .expect_err("unknown anchor types are rejected");
    assert_eq!(
        constraint_name(&err),
        Some("comms_message_threads_anchor_check")
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_live_markdown_mark_in_one_document_is_rejected(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let first = insert_document_root(&pool, DOC).await?;
    let second = insert_document_root(&pool, DOC).await?;
    let other_document = insert_document_root(&pool, OTHER_DOC).await?;

    set_markdown_anchor(&pool, first, "mark-1").await?;
    let err = set_markdown_anchor(&pool, second, "mark-1")
        .await
        .expect_err("one live discussion per mark per document");
    assert_eq!(
        constraint_name(&err),
        Some("idx_comms_message_threads_markdown_mark")
    );

    set_markdown_anchor(&pool, other_document, "mark-1").await?;

    sqlx::query("UPDATE comms_message_threads SET deleted_at = now() WHERE root_id = $1")
        .bind(first)
        .execute(&pool)
        .await?;
    set_markdown_anchor(&pool, second, "mark-1").await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn create_message_channel_reply_path_is_unchanged(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let root = create_message(
        &pool,
        CreateMessageOptions {
            channel_id: CH1,
            sender_id: USER1.to_owned(),
            content: "root".to_owned(),
            thread_id: None,
        },
    )
    .await?;
    let reply = create_message(
        &pool,
        CreateMessageOptions {
            channel_id: CH1,
            sender_id: USER2.to_owned(),
            content: "reply".to_owned(),
            thread_id: Some(root.id),
        },
    )
    .await?;

    assert_eq!(root.channel_id, CH1);
    assert_eq!(root.thread_id, None);
    assert_eq!(reply.channel_id, CH1);
    assert_eq!(reply.thread_id, Some(root.id));
    assert_eq!(reply.sender_id.as_ref(), USER2);

    assert_eq!(parent_columns(&pool, reply.id).await?, channel_parent(CH1));
    assert_eq!(thread_rows(&pool, root.id).await?, 1);
    assert_eq!(thread_rows(&pool, reply.id).await?, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("channels"))
)]
async fn channel_message_backfill_scan_skips_document_rows(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let channel_root = insert_channel_root(&pool, CH1).await?;
    insert_document_root(&pool, DOC).await?;

    let messages = get_channel_messages(&pool, 10, 0, None).await?;
    assert_eq!(messages, vec![(CH1, channel_root)]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pdf_anchors_reference_document_thread_rows(pool: Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id)
         VALUES ('55555555-5555-5555-5555-555555555555', 'owner', 'owner@example.com', 'stripe-test')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           VALUES ($1, 'owner@example.com', '55555555-5555-5555-5555-555555555555')"#,
    )
    .bind(USER1)
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, 'a.pdf', $2, 'pdf')"#,
    )
    .bind(DOC)
    .bind(USER1)
    .execute(&pool)
    .await?;
    sqlx::query(r#"INSERT INTO "Thread" (id, owner, "documentId") VALUES (901, $1, $2)"#)
        .bind(USER1)
        .bind(DOC)
        .execute(&pool)
        .await?;

    let root_id = insert_document_root(&pool, DOC).await?;
    let placeable = Uuid::from_u128(0xf0000000_0000_0000_0000_000000000001);
    let highlight = Uuid::from_u128(0xf0000000_0000_0000_0000_000000000002);
    sqlx::query(
        r#"INSERT INTO "PdfPlaceableCommentAnchor" (
               uuid, "documentId", owner, page, "wasEdited", "wasDeleted", "shouldLockOnSave",
               "originalPage", "originalIndex", "xPct", "yPct", "widthPct", "heightPct", rotation,
               "threadId", root_id
           )
           VALUES ($1, $2, $3, 1, false, false, false, 1, 0, 0.1, 0.1, 0.2, 0.2, 0, 901, $4)"#,
    )
    .bind(placeable)
    .bind(DOC)
    .bind(USER1)
    .bind(root_id)
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"INSERT INTO "PdfHighlightAnchor" (
               uuid, "documentId", owner, page, red, green, blue, alpha, type, text,
               "pageViewportWidth", "pageViewportHeight", root_id
           )
           VALUES ($1, $2, $3, 1, 255, 0, 0, 1.0, 0, 'highlighted', 800, 600, $4)"#,
    )
    .bind(highlight)
    .bind(DOC)
    .bind(USER1)
    .bind(root_id)
    .execute(&pool)
    .await?;

    let err = sqlx::query(
        r#"INSERT INTO "PdfHighlightAnchor" (
               uuid, "documentId", owner, page, red, green, blue, alpha, type, text,
               "pageViewportWidth", "pageViewportHeight", root_id
           )
           VALUES ($1, $2, $3, 1, 255, 0, 0, 1.0, 0, 'dangling', 800, 600, $4)"#,
    )
    .bind(Uuid::from_u128(0xf0000000_0000_0000_0000_000000000003))
    .bind(DOC)
    .bind(USER1)
    .bind(macro_uuid::generate_uuid_v7())
    .execute(&pool)
    .await
    .expect_err("root_id must reference a thread row");
    assert_eq!(
        constraint_name(&err),
        Some("PdfHighlightAnchor_root_id_fkey")
    );

    sqlx::query("DELETE FROM comms_message_threads WHERE root_id = $1")
        .bind(root_id)
        .execute(&pool)
        .await?;

    let placeable_rows: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM "PdfPlaceableCommentAnchor" WHERE uuid = $1"#)
            .bind(placeable)
            .fetch_one(&pool)
            .await?;
    assert_eq!(placeable_rows, 0);
    let highlight_root: Option<Uuid> =
        sqlx::query_scalar(r#"SELECT root_id FROM "PdfHighlightAnchor" WHERE uuid = $1"#)
            .bind(highlight)
            .fetch_one(&pool)
            .await?;
    assert_eq!(highlight_root, None);
    Ok(())
}
