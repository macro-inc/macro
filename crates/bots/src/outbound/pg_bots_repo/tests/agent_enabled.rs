use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_update_and_patch_restore_mention_dispatch_flag(pool: PgPool) -> anyhow::Result<()> {
    let service = service(&pool);
    let mut request = create_agent_req("chat-agent", AgentChannelScope::All);
    request.harness = "in-memory".to_string();
    request.is_coding = false;
    let created = service.create_agent(user_id(USER_OWNER), request).await?;
    assert!(created.bot.has_agent);

    for (enabled, patch) in [(false, false), (true, false), (false, true), (true, true)] {
        sqlx::query!(
            "UPDATE bots SET has_agent = $2 WHERE id = $1",
            created.bot.id.as_uuid(),
            enabled,
        )
        .execute(&pool)
        .await?;

        let updated = if patch {
            service
                .patch_agent(
                    user_id(USER_OWNER),
                    created.bot.id,
                    PatchAgentRequest {
                        instructions: Some("Answer questions in chat.".to_string()),
                        ..Default::default()
                    },
                )
                .await?
        } else {
            service
                .update_agent(
                    user_id(USER_OWNER),
                    created.bot.id,
                    update_agent_req("chat-agent", AgentChannelScope::All),
                )
                .await?
        };
        assert!(updated.bot.has_agent);
        assert!(!updated.is_coding);
        let fetched = service
            .manageable_agent(user_id(USER_OWNER), created.bot.id)
            .await?;
        assert!(fetched.bot.has_agent);
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn backfill_enables_configured_agents_and_preserves_plain_bots(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let configured = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("configured-agent", AgentChannelScope::All),
        )
        .await?;
    let plain = service
        .create_bot(user_id(USER_OWNER), create_req("plain-bot"))
        .await?;
    sqlx::query!(
        "UPDATE bots SET has_agent = false WHERE id = $1",
        configured.bot.id.as_uuid(),
    )
    .execute(&pool)
    .await?;

    for _ in 0..2 {
        sqlx::raw_sql(include_str!(
            "../../../../../macro_db_client/migrations/20261027201315_enable_configured_bot_agents.sql"
        ))
        .execute(&pool)
        .await?;
    }
    assert!(
        service
            .manageable_agent(user_id(USER_OWNER), configured.bot.id)
            .await?
            .bot
            .has_agent
    );
    assert!(
        !PgBotsRepo::new(pool)
            .get_bot(plain.id)
            .await?
            .expect("plain bot")
            .has_agent
    );
    Ok(())
}
