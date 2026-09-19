use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::ports::UserApiKeyAuthorizationRepo as _;

const API_KEY: &str = "mak_authorization_test_secret";
const USER_EMAIL: &str = "user-api-key-authorization@example.com";
const USER_ID: &str = "macro|user-api-key-authorization@example.com";

async fn insert_user_and_key(pool: &PgPool, user_id: &str, email: &str, key: &str) -> Uuid {
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $3)
        "#,
        macro_user_id,
        email,
        format!("stripe_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO "UserApiKey" (id, name, user_id, hash)
        VALUES ($1, $2, $3, $4)
        "#,
        Uuid::new_v4(),
        "test key",
        user_id,
        &hash_user_api_key(key)[..],
    )
    .execute(pool)
    .await
    .unwrap();
    macro_user_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finds_owner_from_user_id_and_macro_user_id(pool: PgPool) {
    let fusion_user_id = insert_user_and_key(&pool, USER_ID, USER_EMAIL, API_KEY).await;
    let repo = PgUserApiKeyAuthorizationRepo::new(pool);

    let owner = repo
        .find_key_owner(API_KEY)
        .await
        .unwrap()
        .expect("valid key");

    assert_eq!(owner.macro_user_id.as_ref(), USER_ID);
    assert_eq!(owner.fusion_user_id, fusion_user_id.to_string());
    assert_eq!(owner.organization_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unknown_key_returns_none(pool: PgPool) {
    insert_user_and_key(&pool, USER_ID, USER_EMAIL, API_KEY).await;
    let repo = PgUserApiKeyAuthorizationRepo::new(pool);

    assert!(repo.find_key_owner("mak_unknown").await.unwrap().is_none());
}
