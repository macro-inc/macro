use super::*;
use crate::messages::delete::delete_message_with_tx;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

const LINK_L1: &str = "00000000-0000-0000-0000-000000000d01";
const LINK_L2: &str = "00000000-0000-0000-0000-000000000d02";
const MESSAGE_M1: &str = "00000000-0000-0000-0000-00000000d501";
const ATTACHMENT_A1: &str = "00000000-0000-0000-0000-0000001da001";
const ATTACHMENT_A2: &str = "00000000-0000-0000-0000-0000001da002";
const DOC_D1: &str = "00000000-0000-0000-0000-00000000dd01";
const DOC_D2: &str = "00000000-0000-0000-0000-00000000dd02";
const DOC_D3: &str = "00000000-0000-0000-0000-00000000dd03";
const FUSIONAUTH_USER: &str = "00000000-0000-0000-0000-000000000d01";

fn id(value: &str) -> Uuid {
    Uuid::parse_str(value).expect("valid fixture uuid")
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("document_email_unlink"))
)]
async fn last_attachment_link_identifies_only_documents_that_flip(
    pool: Pool<Postgres>,
) -> Result<()> {
    let last_for_a1 = documents_losing_last_email_attachment(&pool, &[id(ATTACHMENT_A1)]).await?;
    assert_eq!(last_for_a1, vec![DOC_D1.to_string()]);

    let last_for_a2 = documents_losing_last_email_attachment(&pool, &[id(ATTACHMENT_A2)]).await?;
    assert!(last_for_a2.is_empty());

    let last_for_m1 =
        documents_losing_last_email_attachment_for_messages(&pool, &[id(MESSAGE_M1)]).await?;
    assert_eq!(last_for_m1, vec![DOC_D1.to_string()]);

    let last_for_l1 =
        documents_losing_last_email_attachment_for_links(&pool, &[id(LINK_L1)]).await?;
    assert_eq!(last_for_l1, vec![DOC_D1.to_string(), DOC_D2.to_string()]);

    let last_for_both_links =
        documents_losing_last_email_attachment_for_links(&pool, &[id(LINK_L1), id(LINK_L2)])
            .await?;
    assert_eq!(
        last_for_both_links,
        vec![DOC_D1.to_string(), DOC_D2.to_string(), DOC_D3.to_string()]
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("document_email_unlink"))
)]
async fn insert_attachments_returns_documents_orphaned_off_their_last_link(
    pool: Pool<Postgres>,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    let mut remaining = vec![matching_attachment(
        "shared-d2-a.pdf",
        "application/pdf",
        "provider-att-d002",
        2048,
    )];
    let unlinked =
        crate::attachments::provider::insert_attachments(&mut tx, id(MESSAGE_M1), &mut remaining)
            .await?;
    tx.commit().await?;

    assert_eq!(unlinked, vec![DOC_D1.to_string()]);
    assert!(!document_email_exists(&pool, DOC_D1).await?);
    assert!(document_email_exists(&pool, DOC_D2).await?);
    assert!(document_email_exists(&pool, DOC_D3).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("document_email_unlink"))
)]
async fn delete_message_returns_documents_that_lose_their_last_link(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message = crate::messages::get_simple_messages::get_simple_message(
        &pool,
        &id(MESSAGE_M1),
        FUSIONAUTH_USER,
    )
    .await?
    .expect("fixture message present");

    let mut tx = pool.begin().await?;
    let outcome = delete_message_with_tx(&mut tx, &message).await?;
    tx.commit().await?;

    assert_eq!(outcome.unlinked_document_ids, vec![DOC_D1.to_string()]);
    assert!(!document_email_exists(&pool, DOC_D1).await?);
    assert!(document_email_exists(&pool, DOC_D2).await?);
    assert!(document_email_exists(&pool, DOC_D3).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("document_email_unlink"))
)]
async fn delete_link_returns_documents_that_lose_their_last_link(
    pool: Pool<Postgres>,
) -> Result<()> {
    let unlinked = crate::links::delete::delete_link_by_id(&pool, id(LINK_L1)).await?;

    assert_eq!(unlinked, vec![DOC_D1.to_string(), DOC_D2.to_string()]);
    assert!(!document_email_exists(&pool, DOC_D1).await?);
    assert!(!document_email_exists(&pool, DOC_D2).await?);
    assert!(document_email_exists(&pool, DOC_D3).await?);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("document_email_unlink"))
)]
async fn delete_message_attachments_returns_documents_that_lose_their_last_link(
    pool: Pool<Postgres>,
) -> Result<()> {
    let mut conn = pool.acquire().await?;
    let unlinked =
        crate::attachments::provider::delete_message_attachments(&mut conn, id(MESSAGE_M1)).await?;

    assert_eq!(unlinked, vec![DOC_D1.to_string()]);
    assert!(!document_email_exists(&pool, DOC_D1).await?);
    assert!(document_email_exists(&pool, DOC_D2).await?);
    assert!(document_email_exists(&pool, DOC_D3).await?);

    Ok(())
}

fn matching_attachment(
    filename: &str,
    mime_type: &str,
    provider_id: &str,
    size_bytes: i64,
) -> models_email::service::attachment::Attachment {
    models_email::service::attachment::Attachment {
        db_id: Uuid::new_v4(),
        provider_id: Some(provider_id.to_string()),
        data_url: None,
        filename: Some(filename.to_string()),
        mime_type: Some(mime_type.to_string()),
        size_bytes: Some(size_bytes),
        sfs_id: None,
        content_id: None,
    }
}

async fn document_email_exists(pool: &Pool<Postgres>, document_id: &str) -> Result<bool> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM document_email WHERE document_id = $1) as "exists!""#,
        document_id
    )
    .fetch_one(pool)
    .await?;
    Ok(exists)
}
