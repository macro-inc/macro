use super::*;
use crate::domain::ports::AgentDmEligibility;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_personas_are_private_and_webhook_bots_are_not_personas(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("dm-private", AgentChannelScope::All),
        )
        .await?;
    service
        .authorize_agent_dm(user_id(USER_OWNER), agent.bot.id)
        .await?;
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(USER_OTHER), agent.bot.id)
            .await,
        Err(BotError::Unauthorized)
    ));
    let webhook = service
        .create_bot(user_id(USER_OWNER), create_req("dm-webhook"))
        .await?;
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(USER_OWNER), webhook.id)
            .await,
        Err(BotError::Unauthorized)
    ));
    service
        .delete_bot(user_id(USER_OWNER), agent.bot.id)
        .await?;
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(USER_OWNER), agent.bot.id)
            .await,
        Err(BotError::NotFound(_))
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_members_can_dm_and_revocation_takes_effect_immediately(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = macro_uuid::generate_uuid_v7();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let service = service(&pool);
    let mut request = create_agent_req("dm-team", AgentChannelScope::All);
    request.team_id = Some(team_id);
    let agent = service.create_agent(user_id(TEAM_ADMIN), request).await?;
    service
        .authorize_agent_dm(user_id(TEAM_MEMBER), agent.bot.id)
        .await?;
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(TEAM_OTHER), agent.bot.id)
            .await,
        Err(BotError::Unauthorized)
    ));
    sqlx::query!(
        "DELETE FROM team_user WHERE user_id = $1 AND team_id = $2",
        TEAM_MEMBER,
        team_id
    )
    .execute(&pool)
    .await?;
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(TEAM_MEMBER), agent.bot.id)
            .await,
        Err(BotError::Unauthorized)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_runnable_system_personas_are_available(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    service
        .authorize_agent_dm(user_id(USER_OWNER), bot_id::MACRO_NEW_BOT_ID)
        .await?;
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(USER_OWNER), bot_id::MACRO_SYSTEM_BOT_ID)
            .await,
        Err(BotError::Unauthorized)
    ));
    assert!(matches!(
        service
            .authorize_agent_dm(user_id(USER_OWNER), bot_id::MACRO_AI_BOT_ID)
            .await,
        Err(BotError::Unauthorized)
    ));
    Ok(())
}
