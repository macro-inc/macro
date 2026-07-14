use super::*;
use bot_id::{BotId, BotIdStr};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

async fn insert_public_channel(pool: &PgPool, channel_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id)
        VALUES ($1, 'Bot Channel', 'public', 'owner')
        "#,
        channel_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_bot(pool: &PgPool, bot_principal: &BotIdStr<'_>) {
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, name, handle)
        VALUES ($1, 'system', 'Test Bot', $2)
        "#,
        bot_principal.as_uuid(),
        format!("test-bot-{}", bot_principal.as_uuid()),
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_bot_participant(
    pool: &PgPool,
    channel_id: Uuid,
    bot_principal: &BotIdStr<'_>,
    departed: bool,
) {
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES (
            $1,
            'admin',
            $2,
            CASE WHEN $3 THEN now() ELSE NULL END
        )
        "#,
        channel_id,
        bot_principal.as_ref(),
        departed,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_channel_role_active_participant_receives_stored_role(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let principal = BotId::new_from_uuid(Uuid::new_v4()).into_storage_id();
    insert_public_channel(&pool, channel_id).await;
    insert_bot(&pool, &principal).await;
    insert_bot_participant(&pool, channel_id, &principal, false).await;

    let role = get_bot_channel_role(&pool, &channel_id, &principal).await?;

    assert_eq!(role, ChannelRoleResult::Role(ParticipantRole::Admin));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_channel_role_public_channel_non_participant_has_no_access(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let principal = BotId::new_from_uuid(Uuid::new_v4()).into_storage_id();
    insert_public_channel(&pool, channel_id).await;
    insert_bot(&pool, &principal).await;

    let role = get_bot_channel_role(&pool, &channel_id, &principal).await?;

    assert_eq!(role, ChannelRoleResult::NoAccess);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_channel_role_departed_participant_has_no_access(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let principal = BotId::new_from_uuid(Uuid::new_v4()).into_storage_id();
    insert_public_channel(&pool, channel_id).await;
    insert_bot(&pool, &principal).await;
    insert_bot_participant(&pool, channel_id, &principal, true).await;

    let role = get_bot_channel_role(&pool, &channel_id, &principal).await?;

    assert_eq!(role, ChannelRoleResult::NoAccess);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_channel_role_soft_deleted_participant_has_no_access(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let principal = BotId::new_from_uuid(Uuid::new_v4()).into_storage_id();
    insert_public_channel(&pool, channel_id).await;
    insert_bot(&pool, &principal).await;
    insert_bot_participant(&pool, channel_id, &principal, false).await;
    sqlx::query!(
        "UPDATE bots SET deleted_at = now() WHERE id = $1",
        principal.as_uuid(),
    )
    .execute(&pool)
    .await?;

    let role = get_bot_channel_role(&pool, &channel_id, &principal).await?;

    assert_eq!(role, ChannelRoleResult::NoAccess);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_channel_role_unknown_channel_is_not_found(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let principal = BotId::new_from_uuid(Uuid::new_v4()).into_storage_id();
    insert_bot(&pool, &principal).await;

    let role = get_bot_channel_role(&pool, &channel_id, &principal).await?;

    assert_eq!(role, ChannelRoleResult::NotFound);
    Ok(())
}
