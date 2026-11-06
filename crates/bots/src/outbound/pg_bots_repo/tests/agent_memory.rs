use super::*;
use crate::domain::models::{AgentMemory, UpdateAgentMemoryRequest};

fn write(revision: i64, content: &str) -> UpdateAgentMemoryRequest {
    UpdateAgentMemoryRequest {
        revision,
        content: content.to_string(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_remembers_across_writers_against_its_revision(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("remembering-agent", AgentChannelScope::All),
        )
        .await?;
    let bot = agent.bot.id;

    assert_eq!(service.own_memory(bot).await?, AgentMemory::empty());

    let first = service
        .update_own_memory(bot, write(0, "- The team ships on Thursdays.\n"))
        .await?;
    assert_eq!(first.content, "- The team ships on Thursdays.");
    assert_eq!(first.revision, 1);
    assert!(first.updated_at.is_some());

    // The owner corrects it in settings, against what they loaded.
    let corrected = service
        .update_agent_memory(
            user_id(USER_OWNER),
            bot,
            write(1, "- The team ships on Fridays."),
        )
        .await?;
    assert_eq!(corrected.revision, 2);
    assert_eq!(
        service.agent_memory(user_id(USER_OWNER), bot).await?,
        corrected
    );

    // A session still holding revision 1, and a second first write, both
    // lose without changing anything.
    for stale in [write(1, "- Overwritten."), write(0, "- Overwritten.")] {
        let error = service
            .update_own_memory(bot, stale)
            .await
            .expect_err("a stale revision changes nothing");
        assert!(matches!(error, BotError::Conflict(_)), "{error:?}");
    }
    assert_eq!(service.own_memory(bot).await?, corrected);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_an_agents_managers_read_or_change_its_memory(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("private-memory", AgentChannelScope::All),
        )
        .await?;
    let bot = agent.bot.id;

    assert!(matches!(
        service.agent_memory(user_id(USER_OTHER), bot).await,
        Err(BotError::Unauthorized)
    ));
    assert!(matches!(
        service
            .update_agent_memory(user_id(USER_OTHER), bot, write(0, "- Hijacked."))
            .await,
        Err(BotError::Unauthorized)
    ));
    assert_eq!(service.own_memory(bot).await?, AgentMemory::empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn memory_is_bounded_and_only_custom_agents_have_one(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("bounded-memory", AgentChannelScope::All),
        )
        .await?;

    let too_long = "x".repeat(crate::domain::models::AGENT_MEMORY_MAX_BYTES + 1);
    assert!(matches!(
        service
            .update_own_memory(agent.bot.id, write(0, &too_long))
            .await,
        Err(BotError::BadRequest(_))
    ));
    assert!(matches!(
        service.own_memory(bot_id::MACRO_AI_BOT_ID).await,
        Err(BotError::BadRequest(_))
    ));

    let plain = service
        .create_bot(user_id(USER_OWNER), create_req("plain-bot"))
        .await?;
    assert!(matches!(
        service.own_memory(plain.id).await,
        Err(BotError::NotFound(_))
    ));

    service
        .delete_bot(user_id(USER_OWNER), agent.bot.id)
        .await?;
    assert!(matches!(
        service.own_memory(agent.bot.id).await,
        Err(BotError::NotFound(_))
    ));
    Ok(())
}
