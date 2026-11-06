use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_hidden_toggles_flag(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;

    assert_eq!(fetch_contact_hidden(&pool, contact_id).await?, Some(false));

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_contact_hidden(&team_id, &contact_id, true).await?;
    assert_eq!(fetch_contact_hidden(&pool, contact_id).await?, Some(true));

    repo.set_contact_hidden(&team_id, &contact_id, false)
        .await?;
    assert_eq!(fetch_contact_hidden(&pool, contact_id).await?, Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_hidden_returns_not_found_for_unknown_contact(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .set_contact_hidden(&team_id, &Uuid::now_v7(), true)
        .await;

    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::ContactNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_hidden_isolates_contacts_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    let owner_a = "macro|owner_a@test.com";
    let owner_b = "macro|owner_b@test.com";
    seed_team(&pool, team_a, owner_a).await?;
    seed_team(&pool, team_b, owner_b).await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let link_a = insert_email_link(&pool, owner_a, "a@macro.test").await?;
    let contact_a = insert_contact_with_source(&pool, company_a, "alice@acme.com", link_a).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // team_b mutating team_a's contact must fail without touching the row.
    let result = repo.set_contact_hidden(&team_b, &contact_a, true).await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::ContactNotFoundForTeam)
    ));

    assert_eq!(fetch_contact_hidden(&pool, contact_a).await?, Some(false));
    Ok(())
}
