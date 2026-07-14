#[allow(unused_imports)]
use super::*;
use crate::domain::models::TeamRole;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const TEAM_ALPHA: &str = "00000000-0000-0000-0000-0000000ea001";
const TEAM_BETA: &str = "00000000-0000-0000-0000-0000000ea002";

fn user(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn returns_none_when_user_has_no_team_membership(pool: PgPool) -> Result<()> {
    let user_id = user("macro|noteam@team.com");

    let result = get_user_team(&pool, &user_id).await?;

    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn returns_none_when_user_does_not_exist(pool: PgPool) -> Result<()> {
    let user_id = user("macro|ghost@team.com");

    let result = get_user_team(&pool, &user_id).await?;

    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn returns_member_role_for_member(pool: PgPool) -> Result<()> {
    let user_id = user("macro|member@team.com");

    let result = get_user_team(&pool, &user_id).await?.expect("team info");

    assert_eq!(result.team_id, Uuid::parse_str(TEAM_ALPHA)?);
    assert_eq!(result.role, TeamRole::Member);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn returns_admin_role_for_admin(pool: PgPool) -> Result<()> {
    let user_id = user("macro|admin@team.com");

    let result = get_user_team(&pool, &user_id).await?.expect("team info");

    assert_eq!(result.team_id, Uuid::parse_str(TEAM_ALPHA)?);
    assert_eq!(result.role, TeamRole::Admin);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn returns_owner_role_for_owner(pool: PgPool) -> Result<()> {
    let user_id = user("macro|owner@team.com");

    let result = get_user_team(&pool, &user_id).await?.expect("team info");

    assert_eq!(result.team_id, Uuid::parse_str(TEAM_ALPHA)?);
    assert_eq!(result.role, TeamRole::Owner);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn returns_team_id_of_the_users_actual_team(pool: PgPool) -> Result<()> {
    // `multi@team.com` is the sole member of Team Beta — verifies the query
    // returns the user's real team_id rather than e.g. the first team in the
    // table (Team Alpha).
    let user_id = user("macro|multi@team.com");

    let result = get_user_team(&pool, &user_id).await?.expect("team info");

    assert_eq!(result.team_id, Uuid::parse_str(TEAM_BETA)?);
    assert_eq!(result.role, TeamRole::Owner);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn does_not_leak_other_users_team_memberships(pool: PgPool) -> Result<()> {
    // alpha_owner is referenced as Team Alpha's `owner_id` but has no team_user
    // row — they should not be reported as a team member.
    let user_id = user("macro|alpha_owner@team.com");

    let result = get_user_team(&pool, &user_id).await?;

    assert_eq!(result, None);
    Ok(())
}
