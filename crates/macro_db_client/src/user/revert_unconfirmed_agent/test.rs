use std::collections::HashSet;

use super::revert_unconfirmed_agent;
use crate::user::create_user::create_user;

const EMAIL: &str = "agent@signup.test";

async fn create_agent(pool: &sqlx::PgPool) -> String {
    create_user(
        pool,
        &uuid::Uuid::new_v4().to_string(),
        EMAIL,
        EMAIL,
        false,
        "cus_agent",
        None,
        None,
        HashSet::new(),
        true,
    )
    .await
    .unwrap()
}

async fn is_agent(pool: &sqlx::PgPool) -> bool {
    sqlx::query_scalar!(r#"SELECT "isAgent" FROM "User" WHERE email = $1"#, EMAIL)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test]
async fn an_unproven_agent_flag_is_reverted(pool: sqlx::PgPool) {
    create_agent(&pool).await;

    assert!(revert_unconfirmed_agent(&pool, EMAIL).await.unwrap());
    assert!(!is_agent(&pool).await);
    assert!(!revert_unconfirmed_agent(&pool, EMAIL).await.unwrap());
}

#[sqlx::test]
async fn a_minted_key_proves_the_agent(pool: sqlx::PgPool) {
    let user_id = create_agent(&pool).await;
    sqlx::query!(
        r#"INSERT INTO "UserApiKey" (id, name, user_id, hash) VALUES ($1, 'Agent signup', $2, $3)"#,
        uuid::Uuid::new_v4(),
        user_id,
        &[0u8; 32][..],
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!revert_unconfirmed_agent(&pool, EMAIL).await.unwrap());
    assert!(is_agent(&pool).await);
}

#[sqlx::test]
async fn confirming_setup_proves_the_agent(pool: sqlx::PgPool) {
    create_agent(&pool).await;
    sqlx::query!(
        r#"UPDATE "User" SET "tutorialComplete" = TRUE WHERE email = $1"#,
        EMAIL
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!revert_unconfirmed_agent(&pool, EMAIL).await.unwrap());
    assert!(is_agent(&pool).await);
}
