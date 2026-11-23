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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_manager_credential_resolves_to_the_managed_account_until_revoked(pool: PgPool) {
    const MANAGER_KEY: &str = "mak_manager_secret";
    const MANAGER_ID: &str = "macro|manager-credential@example.com";

    insert_user_and_key(&pool, USER_ID, USER_EMAIL, API_KEY).await;
    insert_user_and_key(
        &pool,
        MANAGER_ID,
        "manager-credential@example.com",
        "mak_own",
    )
    .await;
    let grant_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO account_manager_grants
            (id, managed_user_id, manager_user_id, requested_by, status, key_hash)
        VALUES ($1, $2, $3, 'manager', 'active', $4)
        "#,
        grant_id,
        USER_ID,
        MANAGER_ID,
        &hash_user_api_key(MANAGER_KEY)[..],
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgUserApiKeyAuthorizationRepo::new(pool.clone());

    let owner = repo.find_key_owner(MANAGER_KEY).await.unwrap().unwrap();
    let credential = owner.account_manager.unwrap();
    assert_eq!(owner.macro_user_id.as_ref(), USER_ID);
    assert_eq!(credential.grant_id, grant_id);
    assert_eq!(credential.manager_user_id.as_ref(), MANAGER_ID);

    let own_key = repo.find_key_owner("mak_own").await.unwrap().unwrap();
    assert_eq!(own_key.macro_user_id.as_ref(), MANAGER_ID);
    assert_eq!(own_key.account_manager, None);

    sqlx::query!(
        "UPDATE account_manager_grants SET status = 'revoked', key_hash = NULL WHERE id = $1",
        grant_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(repo.find_key_owner(MANAGER_KEY).await.unwrap().is_none());
}
