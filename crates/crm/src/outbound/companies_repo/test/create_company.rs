use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmError;
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_company_inserts_company_and_domain(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let now = Utc::now();
    let record = repo
        .create_company_for_team(&team_id, Some("Acme.COM"), "Acme", now)
        .await?;

    assert_eq!(record.name.as_deref(), Some("Acme"));
    assert_eq!(record.company.team_id, team_id);
    assert!(!record.company.hidden);
    assert!(record.company.email_sync);
    assert!(record.contacts.is_empty());
    // Domain is stored lowercased.
    assert_eq!(record.company.domains.len(), 1);
    assert_eq!(record.company.domains[0].domain, "acme.com");
    // Interaction endpoints are both seeded from `now` (compare at
    // microsecond precision — Postgres truncates nanoseconds).
    assert_eq!(
        record.company.created_at.timestamp_micros(),
        now.timestamp_micros()
    );
    assert_eq!(
        record.company.updated_at.timestamp_micros(),
        now.timestamp_micros()
    );

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_company_name_overrides_directory_name(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;

    // Directory already resolved a different (global) name for the
    // domain; the team-scoped override must win.
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description)
           VALUES ($1, $2, $3)"#,
    )
    .bind("acme.com")
    .bind("Acme Inc. (directory)")
    .bind("Maker of rocket-powered roller skates.")
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let record = repo
        .create_company_for_team(&team_id, Some("acme.com"), "Acme (ours)", Utc::now())
        .await?;

    assert_eq!(record.name.as_deref(), Some("Acme (ours)"));
    // Description still comes from the directory.
    assert_eq!(
        record.description.as_deref(),
        Some("Maker of rocket-powered roller skates.")
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_company_rejects_duplicate_domain(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // Case-insensitive: "ACME.com" collides with "acme.com".
    let err = repo
        .create_company_for_team(&team_id, Some("ACME.com"), "Acme", Utc::now())
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::CompanyAlreadyExistsForTeam));

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_company_allows_same_domain_on_another_team(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner-a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner-b@test.com").await?;
    enable_crm_for_team(&pool, team_a).await?;
    enable_crm_for_team(&pool, team_b).await?;
    insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let record = repo
        .create_company_for_team(&team_b, Some("acme.com"), "Acme", Utc::now())
        .await?;
    assert_eq!(record.company.team_id, team_b);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_company_requires_crm_enabled(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    // No team_crm_settings row: killswitch defaults to off.

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let err = repo
        .create_company_for_team(&team_id, Some("acme.com"), "Acme", Utc::now())
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::CrmDisabledForTeam));

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_reuses_manually_created_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner, "owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let created = repo
        .create_company_for_team(&team_id, Some("acme.com"), "Acme", Utc::now())
        .await?;

    // A later populate for the same domain attaches its contact to the
    // manually created company instead of inserting a second one.
    let now = Utc::now();
    repo.populate_contact(
        &team_id,
        &link_id,
        "acme.com",
        "jane@acme.com",
        Some("Jane"),
        now,
        now,
        true,
    )
    .await?;

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        1
    );
    assert_eq!(count_contacts(&pool, created.company.id).await?, 1);

    // The manual name override survives the populate.
    let record = repo
        .get_company_for_team(&team_id, &created.company.id, false)
        .await?
        .expect("company should be returned");
    assert_eq!(record.name.as_deref(), Some("Acme"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_listing_uses_name_override(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;

    sqlx::query(r#"INSERT INTO crm_domain_directory (domain, name) VALUES ($1, $2)"#)
        .bind("acme.com")
        .bind("Acme Inc. (directory)")
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let created = repo
        .create_company_for_team(&team_id, Some("acme.com"), "Acme (ours)", Utc::now())
        .await?;

    let listed = repo
        .list_companies_for_soup(
            &team_id,
            "macro|owner@test.com",
            &[],
            None,
            crate::domain::companies_repo::CrmCompanyListSort::UpdatedAt,
            None,
            10,
        )
        .await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].company.id, created.company.id);
    assert_eq!(listed[0].name.as_deref(), Some("Acme (ours)"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn name_only_company_accepts_personal_email_without_inference(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::auth::CrmTeamReceipt;
    use crate::domain::service::{CrmService, CrmServiceImpl};
    use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
    use entity_access::domain::models::MemberTeamRole;

    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let access = CrmTeamReceipt::<MemberTeamRole>::dangerously_internal(team_id);
    let company = service.create_company(&access, "  Acme  ", None).await?;
    assert_eq!(company.name.as_deref(), Some("Acme"));
    assert!(company.company.domains.is_empty());
    assert!(company.description.is_none());

    let contact = repo
        .create_contact_for_company(
            &team_id,
            &company.company.id,
            "jane@gmail.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await?;
    let loaded = repo
        .get_company_for_team(&team_id, &company.company.id, false)
        .await?
        .unwrap();
    assert_eq!(loaded.contacts[0].id, contact.id);
    assert!(loaded.company.domains.is_empty());
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM crm_domain_directory")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM crm_contact_sources")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );

    // Names are labels, not identity: distinct companies may have the same name.
    let other = service.create_company(&access, "Acme", None).await?;
    assert_ne!(other.company.id, company.company.id);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn name_only_company_requires_crm_enabled(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let error = repo
        .create_company_for_team(&team_id, None, "Acme", Utc::now())
        .await
        .unwrap_err();
    assert!(matches!(error, CrmError::CrmDisabledForTeam));
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM crm_companies")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}
