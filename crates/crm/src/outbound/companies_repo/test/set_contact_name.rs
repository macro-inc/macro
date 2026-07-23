use super::helpers::*;
use crate::domain::auth::CrmContactReceipt;
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
async fn set_contact_name_writes_and_overwrites_name(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    // Populate-style contact: no name yet, display falls back to email.
    let contact_id = insert_contact(&pool, company_id, "jane@acme.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_contact_name(&team_id, &contact_id, "Jane Doe", false)
        .await?;

    assert_eq!(
        fetch_contact_name(&pool, contact_id).await?,
        Some(Some("Jane Doe".to_string()))
    );
    // The rename is visible on the read path.
    let record = repo
        .get_contact_for_team(&team_id, &contact_id, false)
        .await?
        .expect("contact should be readable");
    assert_eq!(record.name.as_deref(), Some("Jane Doe"));

    // Renaming again overwrites the previous name.
    repo.set_contact_name(&team_id, &contact_id, "Jane Smith", false)
        .await?;
    assert_eq!(
        fetch_contact_name(&pool, contact_id).await?,
        Some(Some("Jane Smith".to_string()))
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_name_returns_not_found_for_unknown_contact(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .set_contact_name(&team_id, &Uuid::now_v7(), "Jane", false)
        .await;

    assert!(matches!(result, Err(CrmError::ContactNotFoundForTeam)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_name_isolates_contacts_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner_a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner_b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let contact_a = insert_contact(&pool, company_a, "jane@acme.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let result = repo
        .set_contact_name(&team_b, &contact_a, "Hijacked", false)
        .await;

    assert!(matches!(result, Err(CrmError::ContactNotFoundForTeam)));
    assert_eq!(fetch_contact_name(&pool, contact_a).await?, Some(None));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_name_respects_hidden_contact_gate(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "jane@acme.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_contact_hidden(&team_id, &contact_id, true).await?;

    // Member callers (include_hidden = false) can't reach the hidden row.
    let result = repo
        .set_contact_name(&team_id, &contact_id, "Sneaky", false)
        .await;
    assert!(matches!(result, Err(CrmError::ContactNotFoundForTeam)));
    assert_eq!(fetch_contact_name(&pool, contact_id).await?, Some(None));

    // Admin/owner callers (include_hidden = true) can rename it.
    repo.set_contact_name(&team_id, &contact_id, "Admin rename", true)
        .await?;
    assert_eq!(
        fetch_contact_name(&pool, contact_id).await?,
        Some(Some("Admin rename".to_string()))
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_contact_name_respects_hidden_company_gate(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "jane@acme.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_hidden(&team_id, &company_id, true).await?;

    // A visible contact under a hidden company is unreachable for members.
    let result = repo
        .set_contact_name(&team_id, &contact_id, "Sneaky", false)
        .await;
    assert!(matches!(result, Err(CrmError::ContactNotFoundForTeam)));

    // Admin/owner callers can still rename it.
    repo.set_contact_name(&team_id, &contact_id, "Admin rename", true)
        .await?;
    assert_eq!(
        fetch_contact_name(&pool, contact_id).await?,
        Some(Some("Admin rename".to_string()))
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_set_contact_name_trims_and_persists(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "jane@acme.com").await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    let access = CrmContactReceipt::<ViewAccessLevel>::dangerously_internal(contact_id, team_id);
    service
        .set_contact_name(&access, "  Jane Trimmed  ")
        .await?;

    assert_eq!(
        fetch_contact_name(&pool, contact_id).await?,
        Some(Some("Jane Trimmed".to_string()))
    );
    Ok(())
}
