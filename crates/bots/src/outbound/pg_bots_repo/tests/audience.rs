use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_bots_audience_is_its_owner_and_the_people_in_its_current_channels(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("audience-live"))
        .await?;
    let repo = PgBotsRepo::new(pool.clone());

    let current_channel_id = macro_uuid::generate_uuid_v7();
    insert_channel_member(&pool, current_channel_id, USER_OTHER).await?;
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
        VALUES
            ($1, 'macro|left-the-channel@example.com', 'member'::comms_participant_role, now()),
            ($1, 'bot|0196f0a4-6d5e-7c3a-9f00-000000000002', 'member'::comms_participant_role, NULL)
        "#,
        current_channel_id,
    )
    .execute(&pool)
    .await?;
    repo.add_bot_to_channel(current_channel_id, bot.id).await?;

    // A live bot no longer reaches a channel it left.
    let left_channel_id = macro_uuid::generate_uuid_v7();
    insert_channel_member(&pool, left_channel_id, TEAM_OTHER).await?;
    repo.add_bot_to_channel(left_channel_id, bot.id).await?;
    repo.remove_bot_from_channel(left_channel_id, bot.id)
        .await?;

    let mut audience = repo
        .bot_audience(bot.id)
        .await?
        .into_iter()
        .map(|user| user.as_ref().to_string())
        .collect::<Vec<_>>();
    audience.sort();

    assert_eq!(
        audience,
        vec![USER_OTHER.to_string(), USER_OWNER.to_string()]
    );
    Ok(())
}
