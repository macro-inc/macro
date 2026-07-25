use super::*;
use bot_id::{BotId, BotIdStr};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const TEAM_ALPHA: Uuid = Uuid::from_u128(0x000000000000000000000000000ea001);

async fn insert_channel(
    pool: &PgPool,
    channel_id: Uuid,
    channel_type: &str,
    team_id: Option<Uuid>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id, team_id)
        VALUES (
            $1,
            CASE WHEN $2 = 'direct_message' THEN NULL ELSE 'User Channel' END,
            $2::text::comms_channel_type,
            'owner',
            $3
        )
        "#,
        channel_id,
        channel_type,
        team_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_user_participant(
    pool: &PgPool,
    channel_id: Uuid,
    user_id: &str,
    role: &str,
    departed: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
        VALUES (
            $1,
            $2::text::comms_participant_role,
            $3,
            CASE WHEN $4 THEN now() ELSE NULL END
        )
        "#,
        channel_id,
        role,
        user_id,
        departed,
    )
    .execute(pool)
    .await?;
    Ok(())
}

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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn matching_team_member_without_participant_is_view_only(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id, "team", Some(TEAM_ALPHA)).await?;

    let role = get_channel_role(&pool, &channel_id, "macro|member@team.com", None).await?;

    assert_eq!(role, ChannelRoleResult::ViewOnly);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn active_team_channel_participant_receives_stored_role(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let user_id = "macro|member@team.com";
    insert_channel(&pool, channel_id, "team", Some(TEAM_ALPHA)).await?;
    insert_user_participant(&pool, channel_id, user_id, "admin", false).await?;

    let role = get_channel_role(&pool, &channel_id, user_id, None).await?;

    assert_eq!(role, ChannelRoleResult::Role(ParticipantRole::Admin));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn departed_participant_is_view_only_while_team_membership_remains(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    let user_id = "macro|member@team.com";
    insert_channel(&pool, channel_id, "team", Some(TEAM_ALPHA)).await?;
    insert_user_participant(&pool, channel_id, user_id, "member", true).await?;

    let role = get_channel_role(&pool, &channel_id, user_id, None).await?;
    assert_eq!(role, ChannelRoleResult::ViewOnly);

    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", user_id)
        .execute(&pool)
        .await?;

    let role = get_channel_role(&pool, &channel_id, user_id, None).await?;
    assert_eq!(role, ChannelRoleResult::NoAccess);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn unrelated_team_member_has_no_access(pool: PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id, "team", Some(TEAM_ALPHA)).await?;

    let role = get_channel_role(&pool, &channel_id, "macro|multi@team.com", None).await?;

    assert_eq!(role, ChannelRoleResult::NoAccess);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn non_team_channels_do_not_grant_team_members_view_only(pool: PgPool) -> anyhow::Result<()> {
    let user_id = "macro|member@team.com";

    for channel_type in ["private", "direct_message"] {
        let channel_id = Uuid::new_v4();
        insert_channel(&pool, channel_id, channel_type, None).await?;

        let role = get_channel_role(&pool, &channel_id, user_id, None).await?;

        assert_eq!(role, ChannelRoleResult::NoAccess);
    }
    Ok(())
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
