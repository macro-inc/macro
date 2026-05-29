use super::PgAccessRepository;
use crate::domain::{models::AccessError, ports::AccessRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const TEAM_ALPHA: &str = "00000000-0000-0000-0000-0000000ea001";
const TEAM_BETA: &str = "00000000-0000-0000-0000-0000000ea002";
const TEAM_MEMBER: &str = "macro|member@team.com";
const USER_WITHOUT_TEAM: &str = "macro|noteam@team.com";

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).unwrap()
}

async fn insert_foreign_entity(
    pool: &PgPool,
    id: Uuid,
    stored_for_id: &str,
    stored_for_auth_entity: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO foreign_entity (
            id,
            foreign_entity_id,
            foreign_entity_source,
            metadata,
            stored_for_id,
            stored_for_auth_entity
        )
        VALUES ($1, $2, $3, '{}'::jsonb, $4, $5)
        "#,
        id,
        format!("external-{id}"),
        "test-source",
        stored_for_id,
        stored_for_auth_entity,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn grants_direct_user_access(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, USER_WITHOUT_TEAM, "user").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(USER_WITHOUT_TEAM);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn grants_team_access(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, TEAM_ALPHA, "team").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(TEAM_MEMBER);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn denies_unrelated_user_and_team_access(pool: PgPool) -> anyhow::Result<()> {
    let unrelated_user_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, unrelated_user_entity_id, USER_WITHOUT_TEAM, "user").await?;

    let unrelated_team_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, unrelated_team_entity_id, TEAM_BETA, "team").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(TEAM_MEMBER);

    let user_access = repo
        .has_foreign_entity_access(&unrelated_user_entity_id.to_string(), Some(&user_id))
        .await?;
    let team_access = repo
        .has_foreign_entity_access(&unrelated_team_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(!user_access);
    assert!(!team_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn denies_unauthenticated_access(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, USER_WITHOUT_TEAM, "user").await?;

    let repo = PgAccessRepository::new(pool);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), None)
        .await?;

    assert!(!has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn denies_auth_namespace_mismatch(pool: PgPool) -> anyhow::Result<()> {
    let foreign_entity_id = Uuid::new_v4();
    insert_foreign_entity(&pool, foreign_entity_id, USER_WITHOUT_TEAM, "team").await?;

    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(USER_WITHOUT_TEAM);

    let has_access = repo
        .has_foreign_entity_access(&foreign_entity_id.to_string(), Some(&user_id))
        .await?;

    assert!(!has_access);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("user_team"))
)]
async fn rejects_invalid_uuid(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool);
    let user_id = user_id(USER_WITHOUT_TEAM);

    let error = repo
        .has_foreign_entity_access("not-a-uuid", Some(&user_id))
        .await
        .expect_err("invalid UUID should be rejected");

    assert!(matches!(
        error,
        AccessError::BadRequest("Invalid foreign entity ID format")
    ));
    Ok(())
}
