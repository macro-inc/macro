use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::ports::UserApiKeyAuthorizationRepo as _;

const API_KEY: &str = "mak_authorization_test_secret";
const USER_EMAIL: &str = "user-api-key-authorization@example.com";
const FUSION_USER_ID: &str = "fusion-user-api-key-authorization";

async fn insert_user_and_key(pool: &PgPool, user_id: &str, email: &str, key: &str) {
    let macro_user_id = uuid::Uuid::new_v4();
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
        INSERT INTO "UserApiKey" (user_id, key)
        VALUES ($1, $2)
        "#,
        user_id,
        key,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finds_owner_when_user_id_is_fusion_id(pool: PgPool) {
    insert_user_and_key(&pool, FUSION_USER_ID, USER_EMAIL, API_KEY).await;
    let repo = PgUserApiKeyAuthorizationRepo::new(pool);

    let owner = repo
        .find_key_owner(API_KEY)
        .await
        .unwrap()
        .expect("valid key");

    assert_eq!(
        owner.macro_user_id.as_ref(),
        "macro|user-api-key-authorization@example.com"
    );
    assert_eq!(owner.fusion_user_id, FUSION_USER_ID);
    assert_eq!(owner.organization_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finds_owner_when_user_id_is_macro_user_id(pool: PgPool) {
    let macro_user_id = "macro|user-api-key-authorization@example.com";
    insert_user_and_key(&pool, macro_user_id, USER_EMAIL, "mak_macro_id_key").await;
    let repo = PgUserApiKeyAuthorizationRepo::new(pool);

    let owner = repo
        .find_key_owner("mak_macro_id_key")
        .await
        .unwrap()
        .expect("valid key");

    assert_eq!(owner.macro_user_id.as_ref(), macro_user_id);
    assert_eq!(owner.fusion_user_id, macro_user_id);
    assert_eq!(owner.organization_id, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unknown_key_returns_none(pool: PgPool) {
    insert_user_and_key(&pool, FUSION_USER_ID, USER_EMAIL, API_KEY).await;
    let repo = PgUserApiKeyAuthorizationRepo::new(pool);

    assert!(repo.find_key_owner("mak_unknown").await.unwrap().is_none());
}
