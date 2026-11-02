use super::*;
use bots::{
    domain::{models::CreateBotRequest, service::BotServiceImpl},
    outbound::pg_bots_repo::PgBotsRepo,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agents_are_named_by_their_own_bot_rows(pool: PgPool) -> anyhow::Result<()> {
    let macro_user_id = uuid::Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'owner@example.com', 'owner@example.com', 'stripe_owner')",
    )
    .bind(macro_user_id)
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|owner@example.com', 'owner@example.com', $1)"#,
    )
    .bind(macro_user_id)
    .execute(&pool)
    .await?;
    let owner = MacroUserIdStr::try_from("macro|owner@example.com".to_owned())?;

    let bots = BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker);
    let grunk = bots
        .create_bot(
            owner.clone(),
            CreateBotRequest {
                team_id: None,
                name: "Grunk".to_owned(),
                handle: "grunk".to_owned(),
                description: None,
                avatar_url: None,
                has_agent: Some(true),
            },
        )
        .await?;
    let cursor = bots
        .create_bot(
            owner,
            CreateBotRequest {
                team_id: None,
                name: "Cursor".to_owned(),
                handle: "my-cursor".to_owned(),
                description: None,
                avatar_url: None,
                has_agent: Some(true),
            },
        )
        .await?;

    // Two agents editing the same document are told apart by name.
    assert_eq!(agent_name(&bots, grunk.id).await, Some("Grunk".to_owned()));
    assert_eq!(
        agent_name(&bots, cursor.id).await,
        Some("Cursor".to_owned())
    );
    // First-party bots keep their constant names; no lookup.
    assert_eq!(agent_name(&bots, bot_id::MACRO_AI_BOT_ID).await, None);
    // A deleted or unknown agent has no name to present.
    assert_eq!(
        agent_name(&bots, BotId::new_from_uuid(uuid::Uuid::now_v7())).await,
        None
    );
    Ok(())
}
