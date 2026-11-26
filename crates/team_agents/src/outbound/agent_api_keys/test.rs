use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use user_api_key::domain::models::hash_key;
use user_api_key::domain::service::UserApiKeyServiceImpl;
use user_api_key::outbound::pg_user_api_keys_repo::PgUserApiKeysRepo;
use uuid::Uuid;

use super::*;

async fn insert_agent(pool: &PgPool) -> MacroUserIdStr<'static> {
    let macro_user_id = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0022);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'ada-1@agents.macro.invalid', 'ada-1@agents.macro.invalid', 'cus_ada')
        "#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|ada-1@agents.macro.invalid', 'ada-1@agents.macro.invalid', $1, TRUE)"#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    MacroUserIdStr::try_from("macro|ada-1@agents.macro.invalid".to_owned()).unwrap()
}

async fn live(pool: &PgPool, key: &AgentApiKey) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM "UserApiKey" WHERE hash = $1) AS "live!""#,
        &hash_key(key.expose())[..],
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

// Each hand-off to an agent computer issues the agent's environment again,
// and a reconnect hands off again; only the newest key may work.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn minting_an_agent_key_again_revokes_the_one_it_replaces(pool: PgPool) {
    let agent = insert_agent(&pool).await;
    let keys = UserApiKeys::new(Arc::new(UserApiKeyServiceImpl::new(
        PgUserApiKeysRepo::new(pool.clone()),
    )));

    let superseded = keys.mint(&agent).await.unwrap();
    let current = keys.mint(&agent).await.unwrap();

    assert!(!live(&pool, &superseded).await);
    assert!(live(&pool, &current).await);
}
