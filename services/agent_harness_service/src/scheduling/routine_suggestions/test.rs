use super::*;
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, types::Uuid};

const OWNER: &str = "macro|owner@example.com";
const MEMBER: &str = "macro|member@example.com";
const BARRED: &str = "macro|barred@example.com";
const ALONE: &str = "macro|alone@example.com";

async fn person(pool: &PgPool, user: &str) -> sqlx::Result<()> {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        id,
        user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A brief tells a person to draft routines that add CRM companies only
/// where CRM's tools would let those routines run: in a team, with CRM open
/// to them (its owners and admins always, a member unless barred).
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_a_team_member_with_crm_access_may_add_companies(pool: PgPool) -> anyhow::Result<()> {
    for user in [OWNER, MEMBER, BARRED, ALONE] {
        person(&pool, user).await?;
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')",
        team,
        OWNER,
        MEMBER,
        BARRED
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE user_id = $1",
        BARRED
    )
    .execute(&pool)
    .await?;
    let teams = PgAccessRepository::new(pool.clone());
    let crm = CompaniesRepositoryImpl::new(pool.clone());
    for (id, allowed) in [
        (OWNER, true),
        (MEMBER, true),
        (BARRED, false),
        (ALONE, false),
    ] {
        let user = MacroUserIdStr::parse_from_str(id)?;
        assert_eq!(team_crm_access(&teams, &crm, &user).await?, allowed, "{id}");
    }
    Ok(())
}
