use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sync_thread_calendar_flag"))
)]
async fn link_deletion_returns_documents_detached_by_the_commit(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000b01")?;
    let attachment_id = Uuid::parse_str("00000000-0000-0000-0000-0000001ba001")?;
    let document_owner = Uuid::parse_str("00000000-0000-0000-0000-000000000c03")?;
    let document_id = "00000000-0000-0000-0000-00000000dc03";
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, 'link-delete-owner', 'link-delete-owner@example.com', 'cus_link_delete_owner')"#,
        document_owner
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, name, macro_user_id)
           VALUES ($1, 'link-delete-owner@example.com', 'Link Delete Owner', $2)"#,
        document_owner.to_string(),
        document_owner
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType", uploaded, "createdAt", "updatedAt")
           VALUES ($1, 'link-linked.pdf', $2, 'pdf', true, NOW(), NOW())"#,
        document_id,
        document_owner.to_string()
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)",
        document_id,
        attachment_id
    )
    .execute(&pool)
    .await?;

    let outcome = delete_link_by_id(&pool, link_id).await?;

    assert_eq!(outcome.rows_affected, 1);
    assert_eq!(outcome.detached_document_ids, vec![document_id.to_string()]);
    assert!(
        sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM "Document" WHERE id = $1)"#,
            document_id
        )
        .fetch_one(&pool)
        .await?
        .unwrap_or(false)
    );
    assert!(
        !sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM document_email WHERE document_id = $1)",
            document_id
        )
        .fetch_one(&pool)
        .await?
        .unwrap_or(false)
    );
    Ok(())
}
