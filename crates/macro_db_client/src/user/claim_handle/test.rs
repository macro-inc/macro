use super::*;
use crate::user::create_user::create_user;
use std::collections::HashSet;

async fn insert_user(pool: &sqlx::PgPool, fusionauth_user_id: &str, username: &str, email: &str) {
    create_user(
        pool,
        fusionauth_user_id,
        username,
        email,
        true,
        &format!("customer-{fusionauth_user_id}"),
        None,
        None,
        HashSet::new(),
        false,
    )
    .await
    .unwrap();
}

#[sqlx::test]
async fn claimed_handles_are_unique_without_silent_suffixes(pool: sqlx::PgPool) {
    let first = uuid::Uuid::new_v4().to_string();
    let second = uuid::Uuid::new_v4().to_string();
    insert_user(&pool, &first, "ada@example.com", "ada@example.com").await;
    insert_user(&pool, &second, "ada", "second@example.com").await;

    let handle = MailboxHandle::parse("ada").unwrap();
    assert!(matches!(
        claim_handle(&pool, &first, &handle).await,
        Err(ClaimHandleError::Taken)
    ));

    let username = sqlx::query_scalar!("SELECT username FROM macro_user WHERE id = $1", first)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(username, "ada@example.com");
}

#[sqlx::test]
async fn legacy_username_is_preserved_until_claimed(pool: sqlx::PgPool) {
    let user = uuid::Uuid::new_v4().to_string();
    insert_user(&pool, &user, "ada@example.com", "ada@example.com").await;

    claim_handle(&pool, &user, &MailboxHandle::parse("ada").unwrap())
        .await
        .unwrap();
    claim_handle(&pool, &user, &MailboxHandle::parse("ada").unwrap())
        .await
        .unwrap();

    let username = sqlx::query_scalar!("SELECT username FROM macro_user WHERE id = $1", user)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(username, "ada");
}
