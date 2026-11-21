use super::*;
use crate::domain::models::BotIdentity;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn identities_cover_persisted_deleted_and_system_bots_and_omit_unknown_ids(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let mut request = create_req("identity-scout");
    request.name = "Release Scout".to_string();
    request.avatar_url = Some("https://static.example/scout.png".to_string());
    let active = service.create_bot(user_id(USER_OWNER), request).await?;
    let deleted = service
        .create_bot(user_id(USER_OWNER), create_req("identity-gone"))
        .await?;
    service.delete_bot(user_id(USER_OWNER), deleted.id).await?;
    let unknown = BotId::new_from_uuid(Uuid::now_v7());

    let identities = service
        .get_identities(&[
            deleted.id,
            unknown,
            active.id,
            bot_id::MACRO_NEW_BOT_ID,
            active.id,
        ])
        .await?;

    let deleted_at = identities[0].deleted_at;
    assert!(deleted_at.is_some());
    assert_eq!(
        identities,
        vec![
            BotIdentity {
                id: deleted.id,
                name: "Datadog Alerts".to_string(),
                handle: "identity-gone".to_string(),
                avatar_url: None,
                deleted_at,
                is_system: false,
            },
            BotIdentity {
                id: active.id,
                name: "Release Scout".to_string(),
                handle: "identity-scout".to_string(),
                avatar_url: Some("https://static.example/scout.png".to_string()),
                deleted_at: None,
                is_system: false,
            },
            BotIdentity {
                id: bot_id::MACRO_NEW_BOT_ID,
                name: bot_id::MACRO_AI_NAME.to_string(),
                handle: bot_id::system_bot(bot_id::MACRO_NEW_BOT_ID)
                    .expect("registry bot")
                    .handle
                    .to_string(),
                avatar_url: None,
                deleted_at: None,
                is_system: true,
            },
        ]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn identities_reject_more_than_100_ids(pool: PgPool) -> anyhow::Result<()> {
    let ids = (0..101)
        .map(|_| BotId::new_from_uuid(Uuid::now_v7()))
        .collect::<Vec<_>>();

    let error = service(&pool)
        .get_identities(&ids)
        .await
        .expect_err("101 ids are refused");

    match error {
        BotError::BadRequest(message) => {
            assert_eq!(message, "at most 100 bot ids may be requested");
        }
        other => panic!("expected BadRequest, got {other:?}"),
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mentionable_bots_in_a_channel_are_its_bots_then_agents_for_every_channel(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::now_v7();
    insert_channel_member(&pool, channel_id, USER_OWNER).await?;
    let service = service(&pool);
    let installed = service
        .create_bot(user_id(USER_OWNER), create_req("installed-alerts"))
        .await?;
    service
        .add_bot_to_channel(channel_member_receipt(USER_OWNER, channel_id), installed.id)
        .await?;
    let everywhere = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("everywhere-agent", AgentChannelScope::All),
        )
        .await?;
    let mut selected = create_agent_req("selected-agent", AgentChannelScope::Selected);
    selected.channel_ids = vec![channel_id];
    let selected = service.create_agent(user_id(USER_OWNER), selected).await?;
    let elsewhere_channel = Uuid::now_v7();
    insert_channel_member(&pool, elsewhere_channel, USER_OWNER).await?;
    let mut elsewhere = create_agent_req("elsewhere-agent", AgentChannelScope::Selected);
    elsewhere.channel_ids = vec![elsewhere_channel];
    let elsewhere = service.create_agent(user_id(USER_OWNER), elsewhere).await?;

    let in_channel = service
        .list_mentionable_bots(
            user_id(USER_OWNER),
            Some(channel_member_receipt(USER_OWNER, channel_id)),
        )
        .await?
        .into_iter()
        .map(|bot| bot.id)
        .collect::<Vec<_>>();
    // The selected agent is installed in the channel, so it is listed once,
    // as a channel bot; the agent selected for another channel is not here.
    assert_eq!(in_channel.len(), 3);
    assert_eq!(&in_channel[..2], &[installed.id, selected.bot.id]);
    assert_eq!(in_channel[2], everywhere.bot.id);

    let outside_channels = service
        .list_mentionable_bots(user_id(USER_OWNER), None)
        .await?
        .into_iter()
        .map(|bot| bot.id)
        .collect::<Vec<_>>();
    assert_eq!(outside_channels.len(), 3);
    assert_eq!(
        outside_channels
            .into_iter()
            .collect::<std::collections::HashSet<_>>(),
        std::collections::HashSet::from([everywhere.bot.id, selected.bot.id, elsewhere.bot.id])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mentionable_bots_leave_out_agents_whose_mentions_start_nothing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("dormant-agent", AgentChannelScope::All),
        )
        .await?;
    sqlx::query!(
        "UPDATE bots SET has_agent = false WHERE id = $1",
        agent.bot.id.as_uuid(),
    )
    .execute(&pool)
    .await?;

    assert!(
        service
            .list_mentionable_bots(user_id(USER_OWNER), None)
            .await?
            .is_empty()
    );
    Ok(())
}
