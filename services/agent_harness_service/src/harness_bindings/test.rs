use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::types::Uuid;

const OWNER: &str = "macro|bindings@example.com";

async fn insert_harness(pool: &PgPool) -> HarnessId {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, kind, name, owner_user_id, created_by)
        VALUES ($1, 'macrod', 'Laptop', $2, $2)
        "#,
        id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    HarnessId::new_from_uuid(id)
}

async fn insert_bot(pool: &PgPool, harness: HarnessId) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, name, handle, owner_user_id)
        VALUES ($1, 'owned', 'Native agent', $2, $3)
        "#,
        id,
        format!("native-{id}"),
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO agent_configs
            (bot_id, instructions, harness, default_model, channel_scope, is_coding, harness_id)
        VALUES ($1, '', 'macrod', 'default', 'all', true, $2)
        "#,
        id,
        harness.as_uuid(),
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_session(pool: &PgPool, bot: Uuid, acp_session_id: &str) -> AgentSessionId {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO agent_session
            (id, owner_id, bot_id, model, harness, workspace, for_warming, acp_session_id)
        VALUES ($1, $2, $3, 'default', 'macrod', '/srv/agent', false, $4)
        "#,
        id,
        OWNER,
        bot,
        acp_session_id,
    )
    .execute(pool)
    .await
    .unwrap();
    AgentSessionId::new_from_uuid(id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_sessions_resolve_only_on_the_harness_their_bot_is_bound_to(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let other = insert_harness(&pool).await;
    let laptop_bot = insert_bot(&pool, laptop).await;
    let other_bot = insert_bot(&pool, other).await;
    let mine = insert_session(&pool, laptop_bot, "acp-mine").await;
    insert_session(&pool, other_bot, "acp-theirs").await;
    insert_session(&pool, laptop_bot, "acp-not-reported").await;

    let found = PgHarnessBindings::new(pool.clone())
        .sessions_on_harness(
            laptop,
            &[
                SessionId::new("acp-mine"),
                SessionId::new("acp-theirs"),
                SessionId::new("acp-unknown"),
            ],
        )
        .await
        .unwrap();

    assert_eq!(found, [mine]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_harness_reattaches_nothing(pool: PgPool) {
    let laptop = insert_harness(&pool).await;
    let bot = insert_bot(&pool, laptop).await;
    insert_session(&pool, bot, "acp-mine").await;
    sqlx::query!(
        "UPDATE harnesses SET deleted_at = now() WHERE id = $1",
        laptop.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();

    let found = PgHarnessBindings::new(pool.clone())
        .sessions_on_harness(laptop, &[SessionId::new("acp-mine")])
        .await
        .unwrap();

    assert!(found.is_empty());
}
