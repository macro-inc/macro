use sqlx::{Pool, Postgres};

const OWNER: &str = "macro|owner@example.com";
const LINK: &str = "00000000-0000-0000-0000-00000000a001";
const MESSAGE: &str = "00000000-0000-0000-0000-00000000c001";

/// Imported from an attachment on MESSAGE only.
const ONLY_ON_MESSAGE: &str = "0d000000-0000-0000-0000-000000000001";
/// Also linked to an attachment on another message of the same inbox.
const ALSO_ELSEWHERE: &str = "0d000000-0000-0000-0000-000000000002";
/// Imported from MESSAGE, but already in the Trash.
const IN_TRASH: &str = "0d000000-0000-0000-0000-000000000003";

async fn seed(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';

        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ('{LINK}', '{OWNER}', 'owner', 'owner@example.com', 'GMAIL');
        INSERT INTO email_threads (id, link_id)
        VALUES ('00000000-0000-0000-0000-00000000b001', '{LINK}');
        INSERT INTO email_messages (id, thread_id, link_id)
        VALUES ('{MESSAGE}', '00000000-0000-0000-0000-00000000b001', '{LINK}'),
               ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000b001', '{LINK}');
        INSERT INTO email_attachments (id, message_id, filename)
        VALUES ('00000000-0000-0000-0000-0000000e0001', '{MESSAGE}', 'a.pdf'),
               ('00000000-0000-0000-0000-0000000e0002', '{MESSAGE}', 'b.pdf'),
               ('00000000-0000-0000-0000-0000000e0003', '{MESSAGE}', 'c.pdf'),
               ('00000000-0000-0000-0000-0000000e0004', '00000000-0000-0000-0000-00000000c002', 'b.pdf');

        INSERT INTO "Document" (id, name, owner)
        VALUES ('{ONLY_ON_MESSAGE}', 'a', '{OWNER}'), ('{ALSO_ELSEWHERE}', 'b', '{OWNER}'),
               ('{IN_TRASH}', 'c', '{OWNER}');
        UPDATE "Document" SET "deletedAt" = now() WHERE id = '{IN_TRASH}';
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES ('{ONLY_ON_MESSAGE}', '00000000-0000-0000-0000-0000000e0001'),
               ('{ALSO_ELSEWHERE}', '00000000-0000-0000-0000-0000000e0002'),
               ('{IN_TRASH}', '00000000-0000-0000-0000-0000000e0003'),
               ('{ALSO_ELSEWHERE}', '00000000-0000-0000-0000-0000000e0004');

        COMMIT;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

async fn queued(pool: &Pool<Postgres>) -> anyhow::Result<Vec<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT document_id FROM released_email_attachment_documents ORDER BY document_id",
    )
    .fetch_all(pool)
    .await?)
}

#[sqlx::test]
async fn deleting_a_message_queues_the_live_documents_it_leaves_unlinked(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;

    sqlx::query("DELETE FROM email_messages WHERE id = $1::uuid")
        .bind(MESSAGE)
        .execute(&pool)
        .await?;

    assert_eq!(queued(&pool).await?, vec![ONLY_ON_MESSAGE.to_string()]);

    Ok(())
}

#[sqlx::test]
async fn removing_an_inbox_queues_every_live_document_it_imported(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed(&pool).await?;

    sqlx::query("DELETE FROM email_links WHERE id = $1::uuid")
        .bind(LINK)
        .execute(&pool)
        .await?;

    assert_eq!(
        queued(&pool).await?,
        vec![ONLY_ON_MESSAGE.to_string(), ALSO_ELSEWHERE.to_string()]
    );

    Ok(())
}

#[sqlx::test]
async fn purging_a_document_queues_nothing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    seed(&pool).await?;

    sqlx::query(r#"DELETE FROM "Document" WHERE id = $1"#)
        .bind(ONLY_ON_MESSAGE)
        .execute(&pool)
        .await?;

    assert!(queued(&pool).await?.is_empty());

    Ok(())
}
