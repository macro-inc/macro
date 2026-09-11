use super::*;
use sqlx::{Pool, Postgres};

const LIVE_DOCUMENT_ID: &str = "document-live";
const OTHER_DOCUMENT_ID: &str = "document-other";
const OWNER_ID: &str = "macro|user@user.com";

async fn insert_owner(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(macro_user_id)
    .bind(OWNER_ID)
    .bind("user@user.com")
    .bind(OWNER_ID)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(OWNER_ID)
    .bind("user@user.com")
    .bind(macro_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_document(pool: &Pool<Postgres>, document_id: &str) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO public."Document" ("id", "name", "owner")
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(document_id)
    .bind(document_id)
    .bind(OWNER_ID)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_email_attachment(pool: &Pool<Postgres>) -> anyhow::Result<Uuid> {
    let link_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let attachment_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
        VALUES ($1, $2, $3, $4, 'GMAIL', true)
        "#,
    )
    .bind(link_id)
    .bind(OWNER_ID)
    .bind(OWNER_ID)
    .bind("user@user.com")
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO email_contacts (id, link_id, email_address)
        VALUES ($1, $2, 'sender@example.com')
        "#,
    )
    .bind(contact_id)
    .bind(link_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO email_threads (id, link_id, inbox_visible, is_read)
        VALUES ($1, $2, true, false)
        "#,
    )
    .bind(thread_id)
    .bind(link_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO email_messages (
            id, thread_id, link_id, provider_id, is_sent, from_contact_id,
            internal_date_ts, has_attachments, is_read, is_starred, is_draft
        )
        VALUES ($1, $2, $3, $4, false, $5, NOW(), true, false, false, false)
        "#,
    )
    .bind(message_id)
    .bind(thread_id)
    .bind(link_id)
    .bind(format!("provider-msg-{message_id}"))
    .bind(contact_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO email_attachments (
            id, message_id, provider_attachment_id, filename, mime_type, size_bytes
        )
        VALUES ($1, $2, $3, $4, 'application/pdf', 1024)
        "#,
    )
    .bind(attachment_id)
    .bind(message_id)
    .bind(format!("provider-att-{attachment_id}"))
    .bind("contract.pdf")
    .execute(pool)
    .await?;

    Ok(attachment_id)
}

#[sqlx::test]
async fn create_document_email_record_keeps_first_link_on_duplicate_attachment(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_owner(&pool).await?;
    let attachment_id = insert_email_attachment(&pool).await?;
    insert_document(&pool, LIVE_DOCUMENT_ID).await?;
    insert_document(&pool, OTHER_DOCUMENT_ID).await?;

    let mut transaction = pool.begin().await?;
    create_document_email_record(&mut transaction, LIVE_DOCUMENT_ID, attachment_id).await?;
    create_document_email_record(&mut transaction, OTHER_DOCUMENT_ID, attachment_id).await?;
    transaction.commit().await?;

    let linked_document_ids = sqlx::query_scalar::<_, String>(
        r#"
        SELECT document_id
        FROM document_email
        WHERE email_attachment_id = $1
        ORDER BY document_id
        "#,
    )
    .bind(attachment_id)
    .fetch_all(&pool)
    .await?;

    assert_eq!(linked_document_ids, vec![LIVE_DOCUMENT_ID.to_owned()]);
    Ok(())
}

#[sqlx::test]
async fn document_email_attachment_id_is_unique(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_owner(&pool).await?;
    let attachment_id = insert_email_attachment(&pool).await?;
    insert_document(&pool, LIVE_DOCUMENT_ID).await?;
    insert_document(&pool, OTHER_DOCUMENT_ID).await?;

    sqlx::query(
        r#"
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES ($1, $2)
        "#,
    )
    .bind(LIVE_DOCUMENT_ID)
    .bind(attachment_id)
    .execute(&pool)
    .await?;

    let error = sqlx::query(
        r#"
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES ($1, $2)
        "#,
    )
    .bind(OTHER_DOCUMENT_ID)
    .bind(attachment_id)
    .execute(&pool)
    .await
    .expect_err("duplicate email_attachment_id should violate the unique index");

    match error {
        sqlx::Error::Database(db_err) => {
            assert!(db_err.is_unique_violation());
        }
        other => panic!("expected a unique violation, got {other:?}"),
    }

    Ok(())
}
