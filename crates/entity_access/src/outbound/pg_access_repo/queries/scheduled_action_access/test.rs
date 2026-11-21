use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, matrix_viewers, user_in_channel, user_in_team},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|scheduled-action-owner@corp.test";
const STRANGER: &str = "macro|scheduled-action-stranger@corp.test";
/// A participant of `CHANNEL` and nothing else.
const CHANNEL_MEMBER: &str = "macro|scheduled-action-channel-member@corp.test";
/// A member of `TEAM` and nothing else.
const TEAM_MEMBER: &str = "macro|scheduled-action-team-member@corp.test";
const CHANNEL: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_5a11);
const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_5a12);

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::now_v7();
    let email = user_id.trim_start_matches("macro|");

    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $2)
        "#,
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_scheduled_action(pool: &PgPool, owner: &str) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO scheduled_action (
            id, owner, name, schedule, kind, timezone, task, next_run_at, enabled
        )
        VALUES ($1, $2, 'routine', '0 * * * *', 'Agent', 'UTC', '{}'::jsonb, NOW(), true)
        "#,
        id,
        owner,
    )
    .execute(pool)
    .await?;

    Ok(id)
}

async fn grant(
    pool: &PgPool,
    entity_id: Uuid,
    entity_type: &str,
    source_id: &str,
    source_type: &str,
    level: AccessLevel,
) -> anyhow::Result<()> {
    let access_level = level.to_string();

    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level
        )
        VALUES ($1, $2, $3, $4::text::entity_access_source_type, $5::text::"AccessLevel")
        "#,
        entity_id,
        entity_type,
        source_id,
        source_type,
        access_level,
    )
    .execute(pool)
    .await?;

    Ok(())
}

fn user(user_id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(user_id).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_grant_returns_owner(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let action_id = insert_scheduled_action(&pool, OWNER).await?;
    grant(
        &pool,
        action_id,
        "scheduled_action",
        OWNER,
        "user",
        AccessLevel::Owner,
    )
    .await?;

    let access = get_scheduled_action_access(&pool, &action_id, Viewer::User(OWNER)).await?;

    assert_eq!(access, Some(AccessLevel::Owner));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stranger_gets_no_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let action_id = insert_scheduled_action(&pool, OWNER).await?;
    grant(
        &pool,
        action_id,
        "scheduled_action",
        OWNER,
        "user",
        AccessLevel::Owner,
    )
    .await?;

    let access = get_scheduled_action_access(&pool, &action_id, Viewer::User(STRANGER)).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_source_grant_matches(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let action_id = insert_scheduled_action(&pool, OWNER).await?;
    grant(
        &pool,
        action_id,
        "scheduled_action",
        &CHANNEL.to_string(),
        "channel",
        AccessLevel::Edit,
    )
    .await?;

    user_in_channel(&pool, CHANNEL_MEMBER, CHANNEL).await?;

    let matched =
        get_scheduled_action_access(&pool, &action_id, Viewer::User(CHANNEL_MEMBER)).await?;
    let without_channel =
        get_scheduled_action_access(&pool, &action_id, Viewer::User(OWNER)).await?;

    assert_eq!(matched, Some(AccessLevel::Edit));
    assert_eq!(without_channel, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_source_grant_matches(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let action_id = insert_scheduled_action(&pool, OWNER).await?;
    grant(
        &pool,
        action_id,
        "scheduled_action",
        &TEAM.to_string(),
        "team",
        AccessLevel::Comment,
    )
    .await?;

    user_in_team(&pool, TEAM_MEMBER, TEAM).await?;

    let matched = get_scheduled_action_access(&pool, &action_id, Viewer::User(TEAM_MEMBER)).await?;
    let without_team = get_scheduled_action_access(&pool, &action_id, Viewer::User(OWNER)).await?;

    assert_eq!(matched, Some(AccessLevel::Comment));
    assert_eq!(without_team, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn higher_grant_wins(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let action_id = insert_scheduled_action(&pool, OWNER).await?;
    grant(
        &pool,
        action_id,
        "scheduled_action",
        OWNER,
        "user",
        AccessLevel::View,
    )
    .await?;
    grant(
        &pool,
        action_id,
        "scheduled_action",
        &CHANNEL.to_string(),
        "channel",
        AccessLevel::Edit,
    )
    .await?;

    user_in_channel(&pool, OWNER, CHANNEL).await?;

    let access = get_scheduled_action_access(&pool, &action_id, Viewer::User(OWNER)).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accessible_ids_return_the_live_granted_action_once(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let live_id = insert_scheduled_action(&pool, OWNER).await?;
    grant(
        &pool,
        live_id,
        "scheduled_action",
        OWNER,
        "user",
        AccessLevel::Owner,
    )
    .await?;
    grant(
        &pool,
        live_id,
        "scheduled_action",
        &CHANNEL.to_string(),
        "channel",
        AccessLevel::Edit,
    )
    .await?;

    let project_id = Uuid::now_v7();
    grant(
        &pool,
        project_id,
        "project",
        OWNER,
        "user",
        AccessLevel::Owner,
    )
    .await?;

    let missing_action_id = Uuid::now_v7();
    grant(
        &pool,
        missing_action_id,
        "scheduled_action",
        OWNER,
        "user",
        AccessLevel::View,
    )
    .await?;

    user_in_channel(&pool, OWNER, CHANNEL).await?;

    let ids = accessible_scheduled_action_ids(&pool, &user(OWNER)).await?;

    assert_eq!(ids, vec![live_id]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_scheduled_action")
    )
)]
async fn scheduled_action_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let actions = sqlx::query_scalar!(
        r#"SELECT id AS "id!" FROM scheduled_action
           UNION
           SELECT entity_id FROM entity_access WHERE entity_type = 'scheduled_action'
           ORDER BY 1"#
    )
    .fetch_all(&pool)
    .await?;

    assert_matrix_agrees(&viewers, &actions, async |viewer, action_id| {
        Ok((
            source_list_oracle::get_scheduled_action_access(&pool, action_id, &viewer.sources)
                .await?,
            get_scheduled_action_access(&pool, action_id, viewer.viewer()).await?,
        ))
    })
    .await?;

    // Scheduled actions are listed for signed-in users only.
    let users: Vec<_> = viewers
        .into_iter()
        .filter(|viewer| viewer.user_id().is_some())
        .collect();
    assert_matrix_agrees(&users, &["every scheduled action"], async |viewer, _| {
        let user_id = viewer
            .user_id()
            .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
        let mut old =
            source_list_oracle::accessible_scheduled_action_ids(&pool, &viewer.sources).await?;
        let mut new = accessible_scheduled_action_ids(&pool, &user_id).await?;
        old.sort();
        new.sort();
        Ok((old, new))
    })
    .await
}
