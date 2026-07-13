use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("team_channels"))
)]
async fn test_add_team_member_to_channels(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = TeamChannelsRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;

    repo.add_team_member_to_channels(&team_id, &user_id).await?;

    // Verify user3 was added to both team channels
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM comms_channel_participants
        WHERE user_id = $1
        AND role = 'member'::comms_participant_role
        "#,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 2);

    // Calling again should be idempotent (ON CONFLICT DO NOTHING)
    repo.add_team_member_to_channels(&team_id, &user_id).await?;

    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM comms_channel_participants
        WHERE user_id = $1
        AND role = 'member'::comms_participant_role
        "#,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 2);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("team_channels"))
)]
async fn test_remove_team_member_from_channels(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = TeamChannelsRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let user_id = MacroUserIdStr::parse_from_str("macro|user2@user.com")?;

    // Verify user2 is in both channels before removal
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM comms_channel_participants
        WHERE user_id = $1
        "#,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 2);

    repo.remove_team_member_from_channels(&team_id, &user_id)
        .await?;

    // Verify user2 was removed from both team channels
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM comms_channel_participants
        WHERE user_id = $1
        "#,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0);

    // Removing again should be a no-op
    repo.remove_team_member_from_channels(&team_id, &user_id)
        .await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("team_channels"))
)]
async fn test_add_member_to_team_with_no_channels(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = TeamChannelsRepositoryImpl::new(pool.clone());

    // Use a team_id that has no channels
    let team_id = macro_uuid::string_to_uuid("99999999-9999-9999-9999-999999999999")?;
    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;

    // Should succeed without inserting anything
    repo.add_team_member_to_channels(&team_id, &user_id).await?;

    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM comms_channel_participants
        WHERE user_id = $1
        "#,
        user_id.as_ref(),
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0);

    Ok(())
}
