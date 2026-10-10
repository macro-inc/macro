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

/// A direct agent conversation between `owner` and `bot_id`, holding just the
/// two of them as opening one does.
pub(super) async fn insert_direct_conversation(
    pool: &PgPool,
    channel_id: Uuid,
    owner: &str,
    bot_id: BotId,
) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', $2)",
        channel_id,
        owner,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO comms_channel_agents (channel_id, bot_id, kind, user_id) VALUES ($1, $2, 'direct', $3)",
        channel_id,
        bot_id.as_uuid(),
        owner,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
        channel_id,
        owner,
        principal_id(bot_id),
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A team persona's tokens are minted by any member of its team, so none of
/// them may post into the conversation one member has with the persona.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn persona_tokens_cannot_post_into_a_direct_conversation(pool: PgPool) -> anyhow::Result<()> {
    let team_id = macro_uuid::generate_uuid_v7();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let service = service(&pool);
    let mut request = create_agent_req("dm-token", AgentChannelScope::All);
    request.team_id = Some(team_id);
    let agent = service.create_agent(user_id(TEAM_ADMIN), request).await?;
    let shared_channel_id = Uuid::new_v4();
    insert_channel(&pool, shared_channel_id).await?;
    service
        .add_bot_to_channel(
            channel_member_receipt(TEAM_MEMBER, shared_channel_id),
            agent.bot.id,
        )
        .await?;
    let conversation_id = Uuid::new_v4();
    insert_direct_conversation(&pool, conversation_id, TEAM_ADMIN, agent.bot.id).await?;
    let token = service
        .create_token(
            user_id(TEAM_MEMBER),
            agent.bot.id,
            CreateBotTokenRequest {
                label: None,
                expires_at: None,
            },
        )
        .await?;

    service
        .authenticate_channel_token(shared_channel_id, &token.bearer_token)
        .await?;
    assert!(matches!(
        service
            .authenticate_channel_token(conversation_id, &token.bearer_token)
            .await,
        Err(BotError::Unauthorized)
    ));
    Ok(())
}
