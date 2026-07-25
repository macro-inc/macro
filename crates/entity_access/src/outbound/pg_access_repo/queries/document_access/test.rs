#[allow(unused_imports)]
use super::*;
use crate::domain::models::AccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@corp.test";
const REQUESTER: &str = "macro|requester@corp.test";
const OTHER: &str = "macro|other@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str, email: &str) {
    let macro_uuid = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $4)"#,
        macro_uuid,
        user_id,
        email,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_document(pool: &PgPool, document_id: &Uuid, owner: &str) {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'Test Doc', $2)"#,
        document_id.to_string(),
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// An empty link + thread owned by `owner_macro_id`. Returns `(link_id, thread_id)`.
async fn insert_thread(pool: &PgPool, owner_macro_id: &str) -> (Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        owner_macro_id,
        format!("{owner_macro_id}@mail.test"),
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id) VALUES ($1, $2)"#,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();

    (link_id, thread_id)
}

/// A message + attachment on `thread_id`. Returns the attachment id.
async fn insert_attachment(pool: &PgPool, thread_id: Uuid, link_id: Uuid) -> Uuid {
    let message_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id) VALUES ($1, $2, $3)"#,
        message_id,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();

    let attachment_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO email_attachments (id, message_id, filename)
           VALUES ($1, $2, 'resume.pdf')"#,
        attachment_id,
        message_id,
    )
    .execute(pool)
    .await
    .unwrap();

    attachment_id
}

async fn link_document_to_attachment(pool: &PgPool, document_id: &Uuid, attachment_id: Uuid) {
    sqlx::query!(
        r#"INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)"#,
        document_id.to_string(),
        attachment_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_thread_entity_access(
    pool: &PgPool,
    thread_id: Uuid,
    source_id: &str,
    level: AccessLevel,
) {
    let level_str = level.to_string();
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'email_thread', $2, 'user', $3::text::"AccessLevel")"#,
        thread_id,
        source_id,
        level_str,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_document_entity_access(
    pool: &PgPool,
    document_id: &Uuid,
    source_id: &str,
    level: AccessLevel,
) {
    let level_str = level.to_string();
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'document', $2, 'user', $3::text::"AccessLevel")"#,
        document_id,
        source_id,
        level_str,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_access_without_any_grant(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "owner@corp.test").await;
    let document_id = Uuid::new_v4();
    insert_document(&pool, &document_id, OWNER).await;

    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn direct_entity_access_still_grants_access(pool: PgPool) -> anyhow::Result<()> {
    // Regression check: Source 1 (direct entity_access on the document) must
    // keep working once the email-thread source is added.
    insert_user(&pool, OWNER, "owner@corp.test").await;
    let document_id = Uuid::new_v4();
    insert_document(&pool, &document_id, OWNER).await;
    insert_document_entity_access(&pool, &document_id, REQUESTER, AccessLevel::Edit).await;

    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_access_grants_same_level_on_attachment_document(
    pool: PgPool,
) -> anyhow::Result<()> {
    // This is the reported bug: an email attachment uploaded as a Document has
    // no direct ACL entry for anyone but the uploader, so it must inherit
    // access from the source thread instead.
    insert_user(&pool, OWNER, "owner@corp.test").await;
    let document_id = Uuid::new_v4();
    insert_document(&pool, &document_id, OWNER).await;

    let (link_id, thread_id) = insert_thread(&pool, OWNER).await;
    let attachment_id = insert_attachment(&pool, thread_id, link_id).await;
    link_document_to_attachment(&pool, &document_id, attachment_id).await;

    insert_thread_entity_access(&pool, thread_id, REQUESTER, AccessLevel::View).await;

    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_edit_wins_over_direct_view_on_attachment_document(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "owner@corp.test").await;
    let document_id = Uuid::new_v4();
    insert_document(&pool, &document_id, OWNER).await;

    let (link_id, thread_id) = insert_thread(&pool, OWNER).await;
    let attachment_id = insert_attachment(&pool, thread_id, link_id).await;
    link_document_to_attachment(&pool, &document_id, attachment_id).await;

    insert_document_entity_access(&pool, &document_id, REQUESTER, AccessLevel::View).await;
    insert_thread_entity_access(&pool, thread_id, REQUESTER, AccessLevel::Edit).await;

    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_access_scoped_to_requesters_own_source_ids(pool: PgPool) -> anyhow::Result<()> {
    // Someone else's thread grant must not leak access to an unrelated caller.
    insert_user(&pool, OWNER, "owner@corp.test").await;
    let document_id = Uuid::new_v4();
    insert_document(&pool, &document_id, OWNER).await;

    let (link_id, thread_id) = insert_thread(&pool, OWNER).await;
    let attachment_id = insert_attachment(&pool, thread_id, link_id).await;
    link_document_to_attachment(&pool, &document_id, attachment_id).await;

    insert_thread_entity_access(&pool, thread_id, OTHER, AccessLevel::Edit).await;

    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn non_attachment_document_unaffected_by_unrelated_thread_access(
    pool: PgPool,
) -> anyhow::Result<()> {
    // A document that isn't linked via document_email must not pick up access
    // from an otherwise-accessible thread.
    insert_user(&pool, OWNER, "owner@corp.test").await;
    let document_id = Uuid::new_v4();
    insert_document(&pool, &document_id, OWNER).await;

    let (_link_id, thread_id) = insert_thread(&pool, OWNER).await;
    insert_thread_entity_access(&pool, thread_id, REQUESTER, AccessLevel::Edit).await;

    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    let access = get_document_access(&pool, &document_id, &source_ids).await?;

    assert_eq!(access, None);
    Ok(())
}
