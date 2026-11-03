//! Email sync for personal-provider addresses, and contacts without a
//! company.

use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::{CrmError, CrmTeamSettingsPatch};
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

/// A consumer provider. Email sync files only these addresses without a
/// company, and no reserved example domain is one.
const PERSONAL_DOMAIN: &str = "gmail.com";

fn personal(local: &str) -> String {
    format!("{local}@{PERSONAL_DOMAIN}")
}

async fn unfiled_contacts(pool: &PgPool, team_id: Uuid) -> sqlx::Result<Vec<(String, i64)>> {
    sqlx::query_as(
        "SELECT ct.email, (SELECT COUNT(*) FROM crm_contact_sources s WHERE s.contact_id = ct.id)
         FROM crm_contacts ct
         WHERE ct.team_id = $1 AND ct.company_id IS NULL
         ORDER BY ct.email",
    )
    .bind(team_id)
    .fetch_all(pool)
    .await
}

async fn let_personal_emails_in(repo: &CompaniesRepositoryImpl, team_id: Uuid) {
    repo.update_team_settings(
        &team_id,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

async fn populate(
    service: &CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>,
    team_id: Uuid,
    link_id: Uuid,
    email: &str,
    is_sent: bool,
) {
    let now = Utc::now();
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            email,
            Some("Jane"),
            now - Duration::days(1),
            now,
            is_sent,
        )
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_emails_stay_out_by_default(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "user@macro.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);

    assert!(
        repo.get_team_settings(&team_id)
            .await?
            .exclude_personal_emails
    );
    populate(&service, team_id, link_id, &personal("jane"), true).await;

    assert!(unfiled_contacts(&pool, team_id).await?.is_empty());
    assert_eq!(
        count_companies_for_domain(&pool, team_id, PERSONAL_DOMAIN).await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_emails_file_without_a_company_when_let_in(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "user@macro.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team_id).await;

    // Received mail never creates a contact; sent mail does, once.
    populate(&service, team_id, link_id, &personal("jane"), false).await;
    assert!(unfiled_contacts(&pool, team_id).await?.is_empty());
    populate(
        &service,
        team_id,
        link_id,
        &personal("Jane").to_uppercase(),
        true,
    )
    .await;
    populate(&service, team_id, link_id, &personal("jane"), true).await;
    populate(&service, team_id, link_id, &personal("jane"), false).await;
    // Vendor domains stay out even when personal emails are let in.
    populate(&service, team_id, link_id, "billing@vendor.example", true).await;

    assert_eq!(
        unfiled_contacts(&pool, team_id).await?,
        [(personal("jane"), 1)]
    );
    assert_eq!(
        count_companies_for_domain(&pool, team_id, PERSONAL_DOMAIN).await?,
        0
    );
    assert_eq!(
        count_companies_for_domain(&pool, team_id, "vendor.example").await?,
        0
    );

    // Tearing down the only source removes the synced contact.
    let outcome = service
        .depopulate_contact(&team_id, &link_id, &personal("jane"))
        .await?;
    assert!(outcome.source_deleted && outcome.contact_deleted);
    assert!(!outcome.company_deleted);
    assert!(unfiled_contacts(&pool, team_id).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn link_teardown_removes_synced_unfiled_contacts(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "user@macro.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team_id).await;
    populate(&service, team_id, link_id, &personal("jane"), true).await;
    repo.create_contact_for_team(
        &team_id,
        Some(personal("john").as_str()),
        "John",
        Utc::now(),
    )
    .await?;

    repo.depopulate_link_in_team(&team_id, &link_id).await?;

    // The manually created contact survives.
    assert_eq!(
        unfiled_contacts(&pool, team_id).await?,
        [(personal("john"), 0)]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_for_team_without_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    let err = repo
        .create_contact_for_team(&team_id, None, "Jane", Utc::now())
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::CrmDisabledForTeam));

    enable_crm_for_team(&pool, team_id).await?;
    for name in ["Jane", "John"] {
        let contact = repo
            .create_contact_for_team(&team_id, None, name, Utc::now())
            .await?;
        assert_eq!(contact.company_id, None);
        assert_eq!(contact.email, None);
    }
    let contact = repo
        .create_contact_for_team(&team_id, Some("Ann@Example.org"), "Ann", Utc::now())
        .await?;
    assert_eq!(contact.email.as_deref(), Some("ann@example.org"));
    let err = repo
        .create_contact_for_team(&team_id, Some("ann@example.org"), "Ann", Utc::now())
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::ContactAlreadyExistsForCompany));

    // Team-scoped reads reach contacts without a company.
    let found = repo
        .get_contact_for_team(&team_id, &contact.id, false)
        .await?
        .expect("visible");
    assert_eq!(found.company_id, None);
    assert_eq!(
        repo.search_contacts_for_team(&team_id, "ann", 10, false)
            .await?
            .len(),
        1
    );
    repo.set_contact_name(&team_id, &contact.id, "Ann B", false)
        .await?;
    repo.set_contact_hidden(&team_id, &contact.id, true).await?;
    assert!(
        repo.get_contact_for_team(&team_id, &contact.id, false)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_shared_personal_provider_is_not_the_users_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let mailbox = personal("me");
    let link_id = insert_email_link(&pool, OWNER, &mailbox).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team_id).await;

    let now = Utc::now();
    service
        .populate_contact(
            &team_id,
            &link_id,
            &mailbox,
            &personal("jane"),
            Some("Jane"),
            now - Duration::days(1),
            now,
            true,
        )
        .await?;

    assert_eq!(
        unfiled_contacts(&pool, team_id).await?,
        [(personal("jane"), 1)]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn manual_unfiled_contact_does_not_mask_synced_company_contact(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let manual = repo
        .create_contact_for_team(&team_id, Some("contact@acme.test"), "Contact", Utc::now())
        .await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.test"]).await?;
    insert_contact_with_source(&pool, company_id, "contact@acme.test", link_id).await?;

    let outcome = repo
        .depopulate_contact(&team_id, &link_id, "acme.test", "contact@acme.test")
        .await?;
    assert!(outcome.source_deleted && outcome.contact_deleted && outcome.company_deleted);
    assert!(
        repo.get_contact_for_team(&team_id, &manual.id, false)
            .await?
            .is_some()
    );
    Ok(())
}
