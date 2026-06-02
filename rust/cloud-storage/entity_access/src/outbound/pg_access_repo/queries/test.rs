use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|sharedbox@corp.test";
const DELEGATE: &str = "macro|primary@corp.test";

/// macro_user + "User" rows so macro_user_links FKs resolve.
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

/// An empty link + thread owned by `owner_macro_id`. Returns the thread id.
async fn insert_thread(pool: &PgPool, owner_macro_id: &str) -> Uuid {
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

    thread_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_entity_users_includes_inbox_delegate(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "sharedbox@corp.test").await;
    insert_user(&pool, DELEGATE, "primary@corp.test").await;
    let thread_id = insert_thread(&pool, OWNER).await;

    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id) VALUES ($1, $2)"#,
        DELEGATE,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();

    let users = get_entity_users(&pool, &thread_id, EntityType::EmailThread).await?;
    let ids: std::collections::HashSet<String> = users.iter().map(|u| u.to_string()).collect();

    assert!(ids.contains(OWNER), "inbox owner must be included");
    assert!(ids.contains(DELEGATE), "inbox delegate must be included");
    Ok(())
}
