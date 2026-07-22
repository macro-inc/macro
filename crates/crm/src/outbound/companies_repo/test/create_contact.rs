use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmError;
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_inserts_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let now = Utc::now();
    let contact = repo
        .create_contact_for_company(&team_id, &company_id, "Jane@Acme.com", "Jane", now, false)
        .await?;

    // Email is stored lowercased; the contact starts visible and both
    // interaction endpoints seed from `now`.
    assert_eq!(contact.email, "jane@acme.com");
    assert_eq!(contact.name.as_deref(), Some("Jane"));
    assert_eq!(contact.company_id, company_id);
    assert!(!contact.hidden);
    assert_eq!(
        contact.first_interaction.timestamp_micros(),
        now.timestamp_micros()
    );
    assert_eq!(
        contact.last_interaction.timestamp_micros(),
        now.timestamp_micros()
    );

    let listed = repo
        .list_contacts_for_company(&team_id, &company_id, false)
        .await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, contact.id);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_rejects_duplicate_email(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.create_contact_for_company(
        &team_id,
        &company_id,
        "jane@acme.com",
        "Jane",
        Utc::now(),
        false,
    )
    .await?;

    // Case-insensitive: normalization lowercases before the insert.
    let err = repo
        .create_contact_for_company(
            &team_id,
            &company_id,
            "JANE@acme.com",
            "Jane 2",
            Utc::now(),
            false,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::ContactAlreadyExistsForCompany));

    assert_eq!(count_contacts(&pool, company_id).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_rejects_mismatched_domain(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    for email in ["jane@other.com", "jane@gmail.com", "jane@sub.acme.com"] {
        let err = repo
            .create_contact_for_company(&team_id, &company_id, email, "Jane", Utc::now(), false)
            .await
            .unwrap_err();
        assert!(
            matches!(err, CrmError::ContactEmailDomainMismatch),
            "email {email:?}"
        );
    }
    assert_eq!(count_contacts(&pool, company_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_accepts_any_company_domain(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    // Multi-domain company: any of its domains is a valid email domain,
    // matched case-insensitively.
    let company_id = insert_company(&pool, team_id, true, &["acme.com", "Acme.io"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.create_contact_for_company(
        &team_id,
        &company_id,
        "jane@acme.com",
        "Jane",
        Utc::now(),
        false,
    )
    .await?;
    repo.create_contact_for_company(
        &team_id,
        &company_id,
        "jane@ACME.IO",
        "Jane",
        Utc::now(),
        false,
    )
    .await?;
    assert_eq!(count_contacts(&pool, company_id).await?, 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_cross_team_company_not_found(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner-a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner-b@test.com").await?;
    enable_crm_for_team(&pool, team_a).await?;
    enable_crm_for_team(&pool, team_b).await?;
    let company_id = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let err = repo
        .create_contact_for_company(
            &team_b,
            &company_id,
            "jane@acme.com",
            "Jane",
            Utc::now(),
            true,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::CompanyNotFoundForTeam));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_hidden_company_semantics(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_hidden(&team_id, &company_id, true).await?;

    // Members can't reach a hidden company.
    let err = repo
        .create_contact_for_company(
            &team_id,
            &company_id,
            "jane@acme.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::CompanyNotFoundForTeam));

    // Admin/owner can, and the new contact inherits `hidden`.
    let contact = repo
        .create_contact_for_company(
            &team_id,
            &company_id,
            "jane@acme.com",
            "Jane",
            Utc::now(),
            true,
        )
        .await?;
    assert!(contact.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_requires_crm_enabled(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    // Company exists but no team_crm_settings row: killswitch off.
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let err = repo
        .create_contact_for_company(
            &team_id,
            &company_id,
            "jane@acme.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::CrmDisabledForTeam));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_merges_into_manual_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner, "owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let contact = repo
        .create_contact_for_company(
            &team_id,
            &company_id,
            "jane@acme.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await?;

    // A populate for the same email upserts onto the manual row: the
    // manual name wins (first non-NULL), no second contact appears.
    let now = Utc::now();
    repo.populate_contact(
        &team_id,
        &link_id,
        "acme.com",
        "jane@acme.com",
        Some("Jane Doe (observed)"),
        now,
        now,
        true,
    )
    .await?;

    assert_eq!(count_contacts(&pool, company_id).await?, 1);
    let listed = repo
        .list_contacts_for_company(&team_id, &company_id, false)
        .await?;
    assert_eq!(listed[0].id, contact.id);
    assert_eq!(listed[0].name.as_deref(), Some("Jane"));

    // The populate attached a source row; tearing that link down again
    // must keep the manual contact (manually_created shields it from
    // the no-sources orphan cleanup).
    repo.depopulate_contact(&team_id, &link_id, "acme.com", "jane@acme.com")
        .await?;
    assert_eq!(count_contacts(&pool, company_id).await?, 1);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn manual_rows_survive_link_teardown(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner, "owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());

    // A fully manual company (no contacts) and a derived company with a
    // populated contact + a manual contact side by side.
    let manual_company = repo
        .create_company_for_team(&team_id, "manual.com", "Manual Co", Utc::now())
        .await?;
    let derived_company = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    insert_contact_with_source(&pool, derived_company, "bob@acme.com", link_id).await?;
    let manual_contact = repo
        .create_contact_for_company(
            &team_id,
            &derived_company,
            "jane@acme.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await?;

    repo.depopulate_link_in_team(&team_id, &link_id).await?;

    // The populated contact (last source dropped) is gone; the manual
    // contact keeps its company alive; the empty manual company also
    // survives.
    let listed = repo
        .list_contacts_for_company(&team_id, &derived_company, false)
        .await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, manual_contact.id);
    assert_eq!(
        count_companies_for_domain(&pool, team_id, "manual.com").await?,
        1
    );
    let _ = manual_company;
    Ok(())
}
