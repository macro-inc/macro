use super::helpers::*;
use crate::domain::auth::CrmCompanyReceipt;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmError;
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use entity_access::domain::models::ViewAccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_name_writes_override_that_wins_over_directory(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    // Populate-style company: no custom_name, display name resolved
    // from the global directory.
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    sqlx::query(r#"INSERT INTO crm_domain_directory (domain, name) VALUES ($1, $2)"#)
        .bind("acme.com")
        .bind("Acme Inc. (directory)")
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_custom_name(&team_id, &company_id, "Acme (ours)", false)
        .await?;

    assert_eq!(
        fetch_company_custom_name(&pool, company_id).await?,
        Some(Some("Acme (ours)".to_string()))
    );
    // The override wins over the directory name on the read path.
    let record = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?
        .expect("company should be readable");
    assert_eq!(record.name.as_deref(), Some("Acme (ours)"));

    // Renaming again overwrites the previous override.
    repo.set_company_custom_name(&team_id, &company_id, "Acme v2", false)
        .await?;
    assert_eq!(
        fetch_company_custom_name(&pool, company_id).await?,
        Some(Some("Acme v2".to_string()))
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_name_returns_not_found_for_unknown_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .set_company_custom_name(&team_id, &Uuid::now_v7(), "Acme", false)
        .await;

    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_name_isolates_companies_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner_a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner_b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let result = repo
        .set_company_custom_name(&team_b, &company_a, "Hijacked", false)
        .await;

    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));
    assert_eq!(
        fetch_company_custom_name(&pool, company_a).await?,
        Some(None)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_name_respects_hidden_gate(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_hidden(&team_id, &company_id, true).await?;

    // Member callers (include_hidden = false) can't reach the hidden row.
    let result = repo
        .set_company_custom_name(&team_id, &company_id, "Sneaky", false)
        .await;
    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));
    assert_eq!(
        fetch_company_custom_name(&pool, company_id).await?,
        Some(None)
    );

    // Admin/owner callers (include_hidden = true) can rename it.
    repo.set_company_custom_name(&team_id, &company_id, "Admin rename", true)
        .await?;
    assert_eq!(
        fetch_company_custom_name(&pool, company_id).await?,
        Some(Some("Admin rename".to_string()))
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_set_company_name_trims_and_persists(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    let access = CrmCompanyReceipt::<ViewAccessLevel>::dangerously_internal(company_id, team_id);
    service
        .set_company_name(&access, "  Acme Trimmed  ")
        .await?;

    assert_eq!(
        fetch_company_custom_name(&pool, company_id).await?,
        Some(Some("Acme Trimmed".to_string()))
    );
    Ok(())
}
