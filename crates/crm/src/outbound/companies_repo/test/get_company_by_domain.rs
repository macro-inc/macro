//! Resolving a team's company by one of its domains.

use super::helpers::*;
use crate::domain::auth::CrmTeamReceipt;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmError;
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use entity_access::domain::models::MemberTeamRole;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finds_the_team_company_by_any_of_its_domains(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    seed_team(&pool, other_team, "macro|other@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    enable_crm_for_team(&pool, other_team).await?;
    let company =
        insert_company(&pool, team, true, &["Acme.example.com", "acme.example.org"]).await?;
    let foreign = insert_company(&pool, other_team, true, &["shared.example.com"]).await?;
    insert_contact(&pool, company, "jane@acme.example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    for domain in ["acme.example.com", "acme.example.org"] {
        let found = repo
            .get_company_by_domain_for_team(&team, domain, false)
            .await?
            .expect("company found by its domain");
        assert_eq!(found.company.id, company, "{domain}");
        assert_eq!(found.company.domains.len(), 2);
        // Read without its contacts.
        assert!(found.contacts.is_empty());
    }

    assert!(
        repo.get_company_by_domain_for_team(&team, "shared.example.com", true)
            .await?
            .is_none(),
        "another team's company stays out"
    );
    assert!(
        repo.get_company_by_domain_for_team(&other_team, "shared.example.com", false)
            .await?
            .is_some_and(|found| found.company.id == foreign)
    );
    assert!(
        repo.get_company_by_domain_for_team(&team, "missing.example.com", true)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_hidden_company_is_found_only_with_hidden_rows(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["hidden.example.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(company)
        .execute(&pool)
        .await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    assert!(
        repo.get_company_by_domain_for_team(&team, "hidden.example.com", false)
            .await?
            .is_none()
    );
    assert!(
        repo.get_company_by_domain_for_team(&team, "hidden.example.com", true)
            .await?
            .is_some_and(|found| found.company.id == company && found.company.hidden)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_service_normalizes_the_domain_and_rejects_anything_else(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["acme.example.com"]).await?;
    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    let receipt = CrmTeamReceipt::<MemberTeamRole>::dangerously_internal(team);

    let found = service
        .get_company_by_domain(&receipt, " ACME.example.com. ")
        .await?
        .expect("normalized domain found");
    assert_eq!(found.company.id, company);

    for invalid in ["jane@acme.example.com", "https://acme.example.com", "acme"] {
        assert!(
            matches!(
                service.get_company_by_domain(&receipt, invalid).await,
                Err(CrmError::InvalidRequest(_))
            ),
            "{invalid}"
        );
    }
    Ok(())
}
