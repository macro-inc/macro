use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@corp.test";
const REQUESTER: &str = "macro|requester@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
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

async fn insert_project(pool: &PgPool, project_id: Uuid, owner_id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Test Project', $2)"#,
        project_id.to_string(),
        owner_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_link_share(
    pool: &PgPool,
    project_id: Uuid,
    link_share: Option<&str>,
    access_level: Option<&str>,
) -> anyhow::Result<()> {
    let share_permission_id = Uuid::new_v4().to_string();

    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            id,
            "linkShare",
            "linkShareAccessLevel"
        )
        VALUES ($1, $2, $3::text::"AccessLevel")
        "#,
        share_permission_id,
        link_share,
        access_level,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId")
        VALUES ($1, $2)
        "#,
        project_id.to_string(),
        share_permission_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_team(pool: &PgPool, team_id: Uuid, owner_id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Test Team', $2)"#,
        team_id,
        owner_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn add_team_user(
    pool: &PgPool,
    team_id: Uuid,
    user_id: &str,
    role: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, $3::text::team_role)
        "#,
        user_id,
        team_id,
        role,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_entity_access(
    pool: &PgPool,
    project_id: Uuid,
    source_id: &str,
    access_level: AccessLevel,
    granted_from_project_id: Option<Uuid>,
) -> anyhow::Result<()> {
    let access_level = access_level.to_string();
    let granted_from_project_id = granted_from_project_id.map(|id| id.to_string());

    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level,
            granted_from_project_id
        )
        VALUES ($1, 'project', $2, 'user', $3::text::"AccessLevel", $4)
        "#,
        project_id,
        source_id,
        access_level,
        granted_from_project_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

fn anonymous_source_ids() -> SourceIds {
    SourceIds(Vec::new())
}

fn authenticated_source_ids(team_id: Option<Uuid>) -> SourceIds {
    let mut source_ids = vec![REQUESTER.to_string()];
    if let Some(team_id) = team_id {
        source_ids.push(team_id.to_string());
    }
    SourceIds(source_ids)
}

async fn setup_project(pool: &PgPool, link_share: Option<&str>) -> anyhow::Result<Uuid> {
    let project_id = Uuid::new_v4();
    insert_user(pool, OWNER).await?;
    insert_project(pool, project_id, OWNER).await?;
    insert_link_share(pool, project_id, link_share, link_share.map(|_| "comment")).await?;
    Ok(project_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_grants_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, Some("PUBLIC")).await?;

    let access = get_project_access(&pool, &project_id, &anonymous_source_ids()).await?;

    assert_eq!(access, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_grants_authenticated_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, Some("PUBLIC")).await?;

    let access = get_project_access(&pool, &project_id, &authenticated_source_ids(None)).await?;

    assert_eq!(access, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn null_link_denies_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, None).await?;

    let access = get_project_access(&pool, &project_id, &anonymous_source_ids()).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn null_link_denies_authenticated_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, None).await?;

    let access = get_project_access(&pool, &project_id, &authenticated_source_ids(None)).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, Some("TEAM")).await?;

    let access = get_project_access(&pool, &project_id, &anonymous_source_ids()).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_grants_same_team_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, Some("TEAM")).await?;
    let team_id = Uuid::new_v4();
    insert_user(&pool, REQUESTER).await?;
    insert_team(&pool, team_id, OWNER).await?;
    add_team_user(&pool, team_id, OWNER, "owner").await?;
    add_team_user(&pool, team_id, REQUESTER, "member").await?;

    let access =
        get_project_access(&pool, &project_id, &authenticated_source_ids(Some(team_id))).await?;

    assert_eq!(access, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_other_team_access(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, Some("TEAM")).await?;
    let owner_team_id = Uuid::new_v4();
    let requester_team_id = Uuid::new_v4();
    insert_user(&pool, REQUESTER).await?;
    insert_team(&pool, owner_team_id, OWNER).await?;
    add_team_user(&pool, owner_team_id, OWNER, "owner").await?;
    insert_team(&pool, requester_team_id, REQUESTER).await?;
    add_team_user(&pool, requester_team_id, REQUESTER, "owner").await?;

    let access = get_project_access(
        &pool,
        &project_id,
        &authenticated_source_ids(Some(requester_team_id)),
    )
    .await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_when_owner_has_no_team(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, Some("TEAM")).await?;
    let requester_team_id = Uuid::new_v4();
    insert_user(&pool, REQUESTER).await?;
    insert_team(&pool, requester_team_id, REQUESTER).await?;
    add_team_user(&pool, requester_team_id, REQUESTER, "owner").await?;

    let access = get_project_access(
        &pool,
        &project_id,
        &authenticated_source_ids(Some(requester_team_id)),
    )
    .await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explicit_project_access_is_preserved(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, None).await?;
    insert_entity_access(&pool, project_id, REQUESTER, AccessLevel::Edit, None).await?;

    let access = get_project_access(&pool, &project_id, &authenticated_source_ids(None)).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn inherited_project_access_is_preserved(pool: PgPool) -> anyhow::Result<()> {
    let project_id = setup_project(&pool, None).await?;
    let parent_project_id = Uuid::new_v4();
    insert_project(&pool, parent_project_id, OWNER).await?;
    insert_entity_access(
        &pool,
        project_id,
        REQUESTER,
        AccessLevel::Edit,
        Some(parent_project_id),
    )
    .await?;

    let access = get_project_access(&pool, &project_id, &authenticated_source_ids(None)).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}
