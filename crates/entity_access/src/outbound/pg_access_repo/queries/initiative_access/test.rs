use super::*;
use crate::outbound::pg_access_repo::queries::get_user_source_ids;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|initiative-owner@corp.test";
const GRANTEE: &str = "macro|initiative-grantee@corp.test";
const STRANGER: &str = "macro|initiative-stranger@corp.test";
const OWNER_TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_1a01);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_1a02);
const GRANTED_TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_0000_0000_0000_0000_1a03);

#[derive(Clone, Copy)]
enum LinkShare {
    Off,
    Public(AccessLevel),
    Team(AccessLevel),
}

impl LinkShare {
    fn columns(self) -> (Option<&'static str>, Option<String>) {
        match self {
            Self::Off => (None, None),
            Self::Public(level) => (Some("PUBLIC"), Some(level.to_string())),
            Self::Team(level) => (Some("TEAM"), Some(level.to_string())),
        }
    }
}

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

async fn insert_initiative(pool: &PgPool, owner: &str, link: LinkShare) -> anyhow::Result<Uuid> {
    let share_permission_id = Uuid::now_v7().to_string();
    let (link_share, access_level) = link.columns();

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

    let initiative_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO initiative (id, name, owner_user_id, share_permission_id)
        VALUES ($1, 'Test initiative', $2, $3)
        "#,
        initiative_id,
        owner,
        share_permission_id,
    )
    .execute(pool)
    .await?;

    Ok(initiative_id)
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

async fn grant(
    pool: &PgPool,
    initiative_id: Uuid,
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
        VALUES ($1, 'initiative', $2, $3::text::entity_access_source_type, $4::text::"AccessLevel")
        "#,
        initiative_id,
        source_id,
        source_type,
        access_level,
    )
    .execute(pool)
    .await?;

    Ok(())
}

fn sources(ids: &[&str]) -> SourceIds {
    SourceIds(ids.iter().map(ToString::to_string).collect())
}

fn anonymous() -> SourceIds {
    SourceIds(Vec::new())
}

#[cfg(feature = "explain_binary")]
fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_row_grants_owner(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;

    let before = get_initiative_access(&pool, &initiative_id, &sources(&[OWNER])).await?;
    assert_eq!(before, None);

    grant(&pool, initiative_id, OWNER, "user", AccessLevel::Owner).await?;

    let after = get_initiative_access(&pool, &initiative_id, &sources(&[OWNER])).await?;
    assert_eq!(after, Some(AccessLevel::Owner));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_column_is_not_a_grant(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;

    let access = get_initiative_access(&pool, &initiative_id, &sources(&[OWNER])).await?;
    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn initiative_member_is_not_a_grant(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, GRANTEE).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;

    sqlx::query!(
        r#"
        INSERT INTO initiative_member (initiative_id, user_id)
        VALUES ($1, $2)
        "#,
        initiative_id,
        GRANTEE,
    )
    .execute(&pool)
    .await?;

    let access = get_initiative_access(&pool, &initiative_id, &sources(&[GRANTEE])).await?;
    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn direct_user_grant_is_returned(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;
    grant(&pool, initiative_id, GRANTEE, "user", AccessLevel::Edit).await?;

    let grantee = get_initiative_access(&pool, &initiative_id, &sources(&[GRANTEE])).await?;
    let stranger = get_initiative_access(&pool, &initiative_id, &sources(&[STRANGER])).await?;

    assert_eq!(grantee, Some(AccessLevel::Edit));
    assert_eq!(stranger, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_grant_reaches_team_members(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;
    grant(
        &pool,
        initiative_id,
        &GRANTED_TEAM.to_string(),
        "team",
        AccessLevel::Comment,
    )
    .await?;

    let with_team = get_initiative_access(
        &pool,
        &initiative_id,
        &sources(&[GRANTEE, &GRANTED_TEAM.to_string()]),
    )
    .await?;
    let user_only = get_initiative_access(&pool, &initiative_id, &sources(&[GRANTEE])).await?;

    assert_eq!(with_team, Some(AccessLevel::Comment));
    assert_eq!(user_only, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_grant_resolves_through_user_source_ids(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, GRANTEE).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;
    insert_team(&pool, GRANTED_TEAM, OWNER).await?;
    add_team_user(&pool, GRANTED_TEAM, GRANTEE, "member").await?;
    grant(
        &pool,
        initiative_id,
        &GRANTED_TEAM.to_string(),
        "team",
        AccessLevel::Comment,
    )
    .await?;

    let requester = MacroUserIdStr::parse_from_str(GRANTEE).expect("valid requester id");
    let source_ids = get_user_source_ids(&pool, Some(&*requester)).await?;
    let access = get_initiative_access(&pool, &initiative_id, &source_ids).await?;

    assert_eq!(access, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_grants_owner_team_members(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_team(&pool, OWNER_TEAM, OWNER).await?;
    add_team_user(&pool, OWNER_TEAM, OWNER, "owner").await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Team(AccessLevel::View)).await?;

    let owner_team = get_initiative_access(
        &pool,
        &initiative_id,
        &sources(&[GRANTEE, &OWNER_TEAM.to_string()]),
    )
    .await?;
    let other_team = get_initiative_access(
        &pool,
        &initiative_id,
        &sources(&[GRANTEE, &OTHER_TEAM.to_string()]),
    )
    .await?;
    let unauthenticated = get_initiative_access(&pool, &initiative_id, &anonymous()).await?;

    assert_eq!(owner_team, Some(AccessLevel::View));
    assert_eq!(other_team, None);
    assert_eq!(unauthenticated, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_grants_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id =
        insert_initiative(&pool, OWNER, LinkShare::Public(AccessLevel::Comment)).await?;

    let unauthenticated = get_initiative_access(&pool, &initiative_id, &anonymous()).await?;
    let stranger = get_initiative_access(&pool, &initiative_id, &sources(&[STRANGER])).await?;

    assert_eq!(unauthenticated, Some(AccessLevel::Comment));
    assert_eq!(stranger, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_grant_and_no_link_denies(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Off).await?;

    let stranger = get_initiative_access(&pool, &initiative_id, &sources(&[STRANGER])).await?;
    let unauthenticated = get_initiative_access(&pool, &initiative_id, &anonymous()).await?;
    let unknown = get_initiative_access(&pool, &Uuid::now_v7(), &sources(&[OWNER])).await?;

    assert_eq!(stranger, None);
    assert_eq!(unauthenticated, None);
    assert_eq!(unknown, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn highest_level_across_arms_wins(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let public_higher =
        insert_initiative(&pool, OWNER, LinkShare::Public(AccessLevel::Edit)).await?;
    grant(&pool, public_higher, GRANTEE, "user", AccessLevel::View).await?;

    let grant_higher =
        insert_initiative(&pool, OWNER, LinkShare::Public(AccessLevel::View)).await?;
    grant(&pool, grant_higher, GRANTEE, "user", AccessLevel::Edit).await?;

    let from_public = get_initiative_access(&pool, &public_higher, &sources(&[GRANTEE])).await?;
    let from_grant = get_initiative_access(&pool, &grant_higher, &sources(&[GRANTEE])).await?;

    assert_eq!(from_public, Some(AccessLevel::Edit));
    assert_eq!(from_grant, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_when_owner_has_no_team(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let initiative_id = insert_initiative(&pool, OWNER, LinkShare::Team(AccessLevel::Edit)).await?;

    let access = get_initiative_access(
        &pool,
        &initiative_id,
        &sources(&[GRANTEE, &OTHER_TEAM.to_string()]),
    )
    .await?;

    assert_eq!(access, None);
    Ok(())
}

#[cfg(feature = "explain_binary")]
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn explain_agrees_with_access_level(pool: PgPool) -> anyhow::Result<()> {
    use crate::domain::models::{AccessExplanation, AccessGrant, Entity, EntityType};

    insert_user(&pool, OWNER).await?;
    insert_team(&pool, OWNER_TEAM, OWNER).await?;
    add_team_user(&pool, OWNER_TEAM, OWNER, "owner").await?;
    let team_initiative =
        insert_initiative(&pool, OWNER, LinkShare::Team(AccessLevel::View)).await?;
    grant(&pool, team_initiative, GRANTEE, "user", AccessLevel::Edit).await?;

    let src = sources(&[GRANTEE, &OWNER_TEAM.to_string()]);
    let grants = explain_initiative_access(&pool, &team_initiative, &src).await?;
    let explained = AccessExplanation::from_grants(
        user(GRANTEE),
        Entity {
            entity_id: team_initiative.to_string(),
            entity_type: EntityType::Initiative,
        },
        grants.clone(),
    );
    let queried = get_initiative_access(&pool, &team_initiative, &src).await?;

    assert!(grants.iter().any(|grant| matches!(
        grant,
        AccessGrant::EntityAccess {
            source_id,
            access_level: AccessLevel::Edit,
            ..
        } if source_id == GRANTEE
    )));
    assert!(grants.iter().any(|grant| matches!(
        grant,
        AccessGrant::TeamLink {
            access_level: AccessLevel::View,
            owner_team_id,
        } if *owner_team_id == OWNER_TEAM
    )));
    assert!(
        !grants
            .iter()
            .any(|grant| matches!(grant, AccessGrant::PublicLink { .. }))
    );
    assert_eq!(explained.effective_access_level(), queried);
    assert_eq!(queried, Some(AccessLevel::Edit));

    let public_initiative =
        insert_initiative(&pool, OWNER, LinkShare::Public(AccessLevel::Comment)).await?;
    let public_grants = explain_initiative_access(&pool, &public_initiative, &anonymous()).await?;
    assert_eq!(
        public_grants,
        vec![AccessGrant::PublicLink {
            access_level: AccessLevel::Comment
        }]
    );
    Ok(())
}
