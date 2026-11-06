use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const TEAM_ALPHA: Uuid = Uuid::from_u128(0x000000000000000000000000000ea001);
const TEAM_BETA: Uuid = Uuid::from_u128(0x000000000000000000000000000ea002);

async fn insert_company(
    pool: &PgPool,
    company_id: Uuid,
    team_id: Uuid,
    hidden: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO crm_companies (
            id,
            team_id,
            hidden,
            first_interaction,
            last_interaction
        )
        VALUES ($1, $2, $3, now(), now())
        "#,
        company_id,
        team_id,
        hidden,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn team_crm_company_access_returns_view_member_facts(pool: PgPool) -> anyhow::Result<()> {
    let company_id = Uuid::new_v4();
    insert_company(&pool, company_id, TEAM_ALPHA, false).await?;

    let access = get_team_crm_company_access(&pool, &company_id, &TEAM_ALPHA).await?;

    assert_eq!(
        access,
        Some(CrmEntityAccess {
            access_level: AccessLevel::View,
            team_id: TEAM_ALPHA,
            team_role: TeamRole::Member,
        })
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn team_crm_company_access_denies_hidden_company(pool: PgPool) -> anyhow::Result<()> {
    let company_id = Uuid::new_v4();
    insert_company(&pool, company_id, TEAM_ALPHA, true).await?;

    let access = get_team_crm_company_access(&pool, &company_id, &TEAM_ALPHA).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn team_crm_company_access_denies_other_team(pool: PgPool) -> anyhow::Result<()> {
    let company_id = Uuid::new_v4();
    insert_company(&pool, company_id, TEAM_ALPHA, false).await?;

    let access = get_team_crm_company_access(&pool, &company_id, &TEAM_BETA).await?;

    assert_eq!(access, None);
    Ok(())
}
