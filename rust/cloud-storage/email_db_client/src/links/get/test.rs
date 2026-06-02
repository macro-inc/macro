use crate::links::get::{fetch_owned_link_for_message, fetch_owned_link_for_thread};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

const CHILD: &str = "macro|sharedbox@corp.test"; // owns the inbox
const PRIMARY: &str = "macro|primary@corp.test"; // delegate
const STRANGER: &str = "macro|stranger@corp.test"; // no relationship

/// macro_user + "User" rows so macro_user_links FKs resolve.
async fn insert_user(pool: &Pool<Postgres>, macro_id: &str, email: &str) {
    let macro_uuid = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $4)"#,
        macro_uuid,
        macro_id,
        email,
        macro_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        macro_id,
        email,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A link owned by `macro_id` with one thread and one message on it.
/// Returns `(link_id, thread_id, message_id)`.
async fn insert_inbox_with_thread_and_message(
    pool: &Pool<Postgres>,
    macro_id: &str,
    email: &str,
) -> (Uuid, Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        macro_id,
        email,
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

    sqlx::query!(
        r#"INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)"#,
        contact_id,
        link_id,
        "sender@external.test",
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, from_contact_id)
           VALUES ($1, $2, $3, $4)"#,
        message_id,
        thread_id,
        link_id,
        contact_id,
    )
    .execute(pool)
    .await
    .unwrap();

    (link_id, thread_id, message_id)
}

async fn insert_delegation(pool: &Pool<Postgres>, primary: &str, child: &str) {
    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id) VALUES ($1, $2)"#,
        primary,
        child,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_inbox_for_owner_and_delegate(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    let (link_id, thread_id, message_id) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_delegation(&pool, PRIMARY, CHILD).await;

    // Delegate resolves the shared inbox from both thread and message.
    assert_eq!(
        fetch_owned_link_for_thread(&pool, PRIMARY, thread_id)
            .await?
            .map(|l| l.id),
        Some(link_id)
    );
    assert_eq!(
        fetch_owned_link_for_message(&pool, PRIMARY, message_id)
            .await?
            .map(|l| l.id),
        Some(link_id)
    );

    // Owner still resolves their own inbox.
    assert_eq!(
        fetch_owned_link_for_thread(&pool, CHILD, thread_id)
            .await?
            .map(|l| l.id),
        Some(link_id)
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_nothing_for_unrelated_caller(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    insert_user(&pool, STRANGER, "stranger@corp.test").await;
    let (_link_id, thread_id, message_id) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_delegation(&pool, PRIMARY, CHILD).await;

    // STRANGER is a real user who neither owns nor is delegated the inbox.
    assert!(
        fetch_owned_link_for_thread(&pool, STRANGER, thread_id)
            .await?
            .is_none()
    );
    assert!(
        fetch_owned_link_for_message(&pool, STRANGER, message_id)
            .await?
            .is_none()
    );

    Ok(())
}
