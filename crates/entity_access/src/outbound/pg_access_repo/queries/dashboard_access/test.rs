use super::*;
use crate::outbound::pg_access_repo::queries::get_user_source_ids;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

const AGENT: &str = "macro|agent@corp.test";
const ADMIN: &str = "macro|admin@corp.test";
const MEMBER: &str = "macro|member@corp.test";
const OUTSIDE_ADMIN: &str = "macro|outside-admin@corp.test";
const GRANTEE: &str = "macro|grantee@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_uuid = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_uuid,
        user_id,
        macro_uuid.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn mark_agent(pool: &PgPool, user_id: &str) {
    sqlx::query!(
        r#"UPDATE "User" SET "isAgent" = TRUE WHERE id = $1"#,
        user_id
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_dashboard(pool: &PgPool, owner: &str) -> Uuid {
    let dashboard = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO dashboard_entities (id, user_id, current_version) VALUES ($1, $2, 1)",
        dashboard,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    dashboard
}

async fn insert_team(pool: &PgPool, owner: &str, members: &[(&str, &str)]) -> Uuid {
    let team_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    for (user_id, role) in members {
        sqlx::query!(
            r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::text::team_role)"#,
            user_id,
            team_id,
            role,
        )
        .execute(pool)
        .await
        .unwrap();
    }
    team_id
}

async fn level(pool: &PgPool, dashboard: Uuid, user_id: &str) -> Option<AccessLevel> {
    let user = MacroUserIdStr::parse_from_str(user_id).unwrap();
    let sources = get_user_source_ids(pool, Some(&user)).await.unwrap();
    get_dashboard_access(pool, dashboard, user_id, &sources)
        .await
        .unwrap()
}

/// The owner owns it, admins of the agent owner's team edit it, plain members and
/// admins of other teams see nothing, and a direct grant gives its level.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dashboard_access_follows_owner_team_admins_and_grants(pool: PgPool) {
    for user in [AGENT, ADMIN, MEMBER, OUTSIDE_ADMIN, GRANTEE] {
        insert_user(&pool, user).await;
    }
    insert_team(
        &pool,
        ADMIN,
        &[(AGENT, "member"), (ADMIN, "admin"), (MEMBER, "member")],
    )
    .await;
    insert_team(&pool, OUTSIDE_ADMIN, &[(OUTSIDE_ADMIN, "owner")]).await;
    mark_agent(&pool, AGENT).await;

    let dashboard = insert_dashboard(&pool, AGENT).await;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'dashboard', $2, 'user', 'view')"#,
        dashboard,
        GRANTEE,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        level(&pool, dashboard, AGENT).await,
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        level(&pool, dashboard, ADMIN).await,
        Some(AccessLevel::Edit)
    );
    assert_eq!(level(&pool, dashboard, MEMBER).await, None);
    assert_eq!(level(&pool, dashboard, OUTSIDE_ADMIN).await, None);
    assert_eq!(
        level(&pool, dashboard, GRANTEE).await,
        Some(AccessLevel::View)
    );
    assert_eq!(level(&pool, Uuid::now_v7(), AGENT).await, None);
}

/// Team owners and admins edit every dashboard an agent teammate owns, but
/// get nothing on a human teammate's dashboard.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_admins_reach_only_agent_teammates_dashboards(pool: PgPool) {
    for user in [AGENT, ADMIN, MEMBER] {
        insert_user(&pool, user).await;
    }
    insert_team(
        &pool,
        ADMIN,
        &[(AGENT, "member"), (ADMIN, "owner"), (MEMBER, "member")],
    )
    .await;
    mark_agent(&pool, AGENT).await;

    let agents_home = insert_dashboard(&pool, AGENT).await;
    let agents_other = insert_dashboard(&pool, AGENT).await;
    let humans = insert_dashboard(&pool, MEMBER).await;

    assert_eq!(
        level(&pool, agents_home, ADMIN).await,
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        level(&pool, agents_other, ADMIN).await,
        Some(AccessLevel::Edit)
    );
    assert_eq!(level(&pool, humans, ADMIN).await, None);
    assert_eq!(level(&pool, humans, MEMBER).await, Some(AccessLevel::Owner));
}
