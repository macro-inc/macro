//! A contact created without naming a company is filed by its email domain,
//! the way email sync files one.

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

fn service(pool: &PgPool) -> CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver> {
    CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    )
}

async fn team(pool: &PgPool) -> anyhow::Result<(Uuid, CrmTeamReceipt<MemberTeamRole>)> {
    let team_id = Uuid::now_v7();
    seed_team(pool, team_id, "macro|owner@example.com").await?;
    enable_crm_for_team(pool, team_id).await?;
    Ok((team_id, CrmTeamReceipt::dangerously_internal(team_id)))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_address_joins_the_existing_company_for_its_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team_id, receipt) = team(&pool).await?;
    let company_id = insert_company(&pool, team_id, true, &["Example.com"]).await?;

    let contact = service(&pool)
        .create_team_contact(&receipt, "Jane", Some("Jane@example.com"))
        .await?;

    assert_eq!(contact.company_id, Some(company_id));
    assert_eq!(contact.email.as_deref(), Some("jane@example.com"));
    assert_eq!(contact.company_domain_emails, ["jane@example.com"]);
    assert!(!contact.hidden);
    assert_eq!(
        count_companies_for_domain(&pool, team_id, "example.com").await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_address_creates_the_company_sync_would_create(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, receipt) = team(&pool).await?;

    let contact = service(&pool)
        .create_team_contact(&receipt, "Jane", Some("jane@example.com"))
        .await?;

    let company_id = fetch_company_for_domain(&pool, team_id, "example.com")
        .await?
        .expect("company created for the domain");
    assert_eq!(contact.company_id, Some(company_id));
    let (custom_name, manually_created, hidden): (Option<String>, bool, bool) = sqlx::query_as(
        "SELECT custom_name, manually_created, hidden FROM crm_companies WHERE id = $1",
    )
    .bind(company_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        (custom_name, manually_created, hidden),
        (None, false, false)
    );
    // The directory entry waits for the enrichment worker to name it.
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM crm_domain_directory WHERE domain = 'example.com' AND enriched_at IS NULL",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(pending, 1);

    // A second contact at the domain joins the same company.
    let second = service(&pool)
        .create_team_contact(&receipt, "Joe", Some("joe@example.com"))
        .await?;
    assert_eq!(second.company_id, Some(company_id));
    assert_eq!(
        count_companies_for_domain(&pool, team_id, "example.com").await?,
        1
    );

    // Creating by hand reads no mail: no mailbox is recorded as a source.
    let sources: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = ANY($1)")
            .bind([contact.id, second.id])
            .fetch_one(&pool)
            .await?;
    assert_eq!(sources, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_generic_and_missing_addresses_stay_without_a_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team_id, receipt) = team(&pool).await?;

    for (name, email) in [
        ("Personal", Some(concat!("jane@", "gmail.com"))),
        ("Vendor", Some(concat!("jane@", "github.com"))),
        ("Nameless", None),
    ] {
        let contact = service(&pool)
            .create_team_contact(&receipt, name, email)
            .await?;
        assert_eq!(contact.company_id, None, "{name}");
    }

    let companies: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM crm_companies WHERE team_id = $1")
            .bind(team_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(companies, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn blocked_domain_creates_no_company_and_joins_none(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, receipt) = team(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let tracked = insert_company(&pool, team_id, true, &["tracked.example.com"]).await?;
    repo.block_domain(&team_id, "tracked.example.com").await?;
    repo.block_domain(&team_id, "untracked.example.com").await?;

    for email in ["jane@tracked.example.com", "jane@untracked.example.com"] {
        let contact = service(&pool)
            .create_team_contact(&receipt, "Jane", Some(email))
            .await?;
        assert_eq!(contact.company_id, None, "{email}");
    }

    assert_eq!(count_contacts(&pool, tracked).await?, 0);
    assert_eq!(
        fetch_company_for_domain(&pool, team_id, "untracked.example.com").await?,
        None
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn hidden_company_takes_no_new_contact(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, receipt) = team(&pool).await?;
    let company_id = insert_company(&pool, team_id, true, &["example.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(company_id)
        .execute(&pool)
        .await?;

    let contact = service(&pool)
        .create_team_contact(&receipt, "Jane", Some("jane@example.com"))
        .await?;

    assert_eq!(contact.company_id, None);
    assert!(!contact.hidden);
    assert_eq!(count_contacts(&pool, company_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_address_the_team_already_has_is_a_conflict(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, receipt) = team(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company_id = insert_company(&pool, team_id, true, &["example.com"]).await?;
    insert_contact(&pool, company_id, "filed@example.com").await?;
    repo.create_contact_for_team(
        &team_id,
        Some("unfiled@example.com"),
        "Unfiled",
        chrono::Utc::now(),
    )
    .await?;

    for email in ["filed@example.com", "Unfiled@example.com"] {
        let error = service(&pool)
            .create_team_contact(&receipt, "Again", Some(email))
            .await
            .unwrap_err();
        assert!(
            matches!(error, CrmError::ContactAlreadyExistsForCompany),
            "{email}: {error:?}"
        );
    }

    let contacts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM crm_contacts WHERE team_id = $1")
        .bind(team_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(contacts, 2);
    Ok(())
}
