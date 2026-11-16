use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const OWNER: &str = "macro|owner@example.com";
const UPLOADED: &str = "0a7c0000-0000-7000-8000-000000000001";
const ATTACHMENT: &str = "0a7c0000-0000-7000-8000-000000000002";
const EMAIL_ATTACHMENT: &str = "0a7c0000-0000-7000-8000-0000000000e1";

/// Two documents the owner holds: one they uploaded and one imported from an
/// email attachment. Foreign keys are off, so the attachment link needs no mail.
async fn seed_owned_documents(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        VALUES ('{UPLOADED}', 'Uploaded', '{OWNER}'), ('{ATTACHMENT}', 'Attachment', '{OWNER}');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('{UPLOADED}', 'document', '{OWNER}', 'user', 'owner'),
               ('{ATTACHMENT}', 'document', '{OWNER}', 'user', 'owner');
        INSERT INTO document_email (document_id, email_attachment_id)
        VALUES ('{ATTACHMENT}', '{EMAIL_ATTACHMENT}');
        COMMIT;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn excluding_attachments_searches_only_the_owners_other_documents(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_owned_documents(&pool).await?;

    let filters = DocumentFilters {
        is_email_attachment: Some(false),
        ..Default::default()
    };
    let response = filter_documents(&pool, OWNER, &filters).await?;

    // Searching anything beyond the ids would let OpenSearch match the
    // owner's attachment through its owner field.
    assert!(response.ids_only);
    assert_eq!(response.document_ids, vec![UPLOADED.to_string()]);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_filter_still_excludes_attachments(pool: Pool<Postgres>) -> anyhow::Result<()> {
    seed_owned_documents(&pool).await?;

    let filters = DocumentFilters {
        owners: vec![OWNER.to_string()],
        is_email_attachment: Some(false),
        ..Default::default()
    };
    let response = filter_documents(&pool, OWNER, &filters).await?;

    assert!(response.ids_only);
    assert_eq!(response.document_ids, vec![UPLOADED.to_string()]);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_attachments_searches_only_the_owners_attachments(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_owned_documents(&pool).await?;

    let filters = DocumentFilters {
        is_email_attachment: Some(true),
        ..Default::default()
    };
    let response = filter_documents(&pool, OWNER, &filters).await?;

    assert!(response.ids_only);
    assert_eq!(response.document_ids, vec![ATTACHMENT.to_string()]);

    Ok(())
}

// Accessible-item lookups are cached by user across tests in this process,
// so the cap tests have a user of their own, seeded the same in both.
const READER: &str = "macro|reader@example.com";
const COLLEAGUE: &str = "macro|colleague@example.com";
const READERS_OWN: &str = "0a7c0000-0000-7000-8000-000000000003";
const SHARED: &str = "0a7c0000-0000-7000-8000-000000000004";

/// A document the reader owns and one a colleague shared with them.
async fn seed_reader_documents(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "Document" (id, name, owner)
        VALUES ('{READERS_OWN}', 'Own', '{READER}'), ('{SHARED}', 'Shared', '{COLLEAGUE}');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('{READERS_OWN}', 'document', '{READER}', 'user', 'owner'),
               ('{SHARED}', 'document', '{COLLEAGUE}', 'user', 'owner'),
               ('{SHARED}', 'document', '{READER}', 'user', 'view');
        COMMIT;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_attachment_filtered_list_over_the_terms_cap_searches_as_before(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_reader_documents(&pool).await?;

    let filters = DocumentFilters {
        is_email_attachment: Some(false),
        ..Default::default()
    };
    // The reader can reach two non-attachment documents, one more than fits.
    let response = filter_documents_within(&pool, READER, &filters, 1).await?;

    // As before the filter applied: what is shared with the reader, plus
    // everything they own through OpenSearch's owner match.
    assert!(!response.ids_only);
    assert_eq!(response.document_ids, vec![SHARED.to_string()]);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_filters_keep_the_attachment_filter_over_the_terms_cap(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_reader_documents(&pool).await?;

    let filters = DocumentFilters {
        owners: vec![READER.to_string()],
        is_email_attachment: Some(false),
        ..Default::default()
    };
    let response = filter_documents_within(&pool, READER, &filters, 0).await?;

    assert!(response.ids_only);
    assert_eq!(response.document_ids, vec![READERS_OWN.to_string()]);

    Ok(())
}
