use super::*;
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

async fn seed_team(pool: &PgPool, team_id: Uuid, owner_id: &str) -> sqlx::Result<()> {
    let macro_user_id = Uuid::now_v7();

    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)"#,
    )
    .bind(macro_user_id)
    .bind(owner_id)
    .bind(format!("{owner_id}@test.com"))
    .bind(format!("stripe_{macro_user_id}"))
    .execute(pool)
    .await?;

    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#)
        .bind(owner_id)
        .bind(format!("{owner_id}@test.com"))
        .bind(macro_user_id)
        .execute(pool)
        .await?;

    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)"#)
        .bind(team_id)
        .bind("test team")
        .bind(owner_id)
        .execute(pool)
        .await?;

    Ok(())
}

async fn insert_company(
    pool: &PgPool,
    team_id: Uuid,
    email_sync: bool,
    domains: &[&str],
) -> sqlx::Result<Uuid> {
    let company_id = Uuid::now_v7();

    sqlx::query(r#"INSERT INTO crm_companies (id, team_id, email_sync) VALUES ($1, $2, $3)"#)
        .bind(company_id)
        .bind(team_id)
        .bind(email_sync)
        .execute(pool)
        .await?;

    for domain in domains {
        sqlx::query(r#"INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)"#)
            .bind(company_id)
            .bind(team_id)
            .bind(*domain)
            .execute(pool)
            .await?;
    }

    Ok(company_id)
}

async fn insert_email_link(pool: &PgPool, owner_id: &str, email: &str) -> sqlx::Result<Uuid> {
    let link_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $3, $4, 'GMAIL')"#,
    )
    .bind(link_id)
    .bind(owner_id)
    .bind(format!("fa_{link_id}"))
    .bind(email)
    .execute(pool)
    .await?;
    Ok(link_id)
}

async fn insert_contact_with_source(
    pool: &PgPool,
    company_id: Uuid,
    email: &str,
    link_id: Uuid,
) -> sqlx::Result<Uuid> {
    let contact_id = Uuid::now_v7();
    sqlx::query(r#"INSERT INTO crm_contacts (id, company_id, email) VALUES ($1, $2, $3)"#)
        .bind(contact_id)
        .bind(company_id)
        .bind(email)
        .execute(pool)
        .await?;
    sqlx::query(r#"INSERT INTO crm_contact_sources (contact_id, link_id) VALUES ($1, $2)"#)
        .bind(contact_id)
        .bind(link_id)
        .execute(pool)
        .await?;
    Ok(contact_id)
}

async fn count_contacts(pool: &PgPool, company_id: Uuid) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM crm_contacts WHERE company_id = $1"#)
            .bind(company_id)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

async fn count_sources_for_company(pool: &PgPool, company_id: Uuid) -> sqlx::Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM crm_contact_sources cs
           JOIN crm_contacts ct ON ct.id = cs.contact_id
           WHERE ct.company_id = $1"#,
    )
    .bind(company_id)
    .fetch_one(pool)
    .await?;
    Ok(count)
}

async fn fetch_email_sync(pool: &PgPool, company_id: Uuid) -> sqlx::Result<Option<bool>> {
    let row: Option<(bool,)> =
        sqlx::query_as(r#"SELECT email_sync FROM crm_companies WHERE id = $1"#)
            .bind(company_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(s,)| s))
}

async fn fetch_company_hidden(pool: &PgPool, company_id: Uuid) -> sqlx::Result<Option<bool>> {
    let row: Option<(bool,)> = sqlx::query_as(r#"SELECT hidden FROM crm_companies WHERE id = $1"#)
        .bind(company_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(h,)| h))
}

async fn fetch_contact_hidden(pool: &PgPool, contact_id: Uuid) -> sqlx::Result<Option<bool>> {
    let row: Option<(bool,)> = sqlx::query_as(r#"SELECT hidden FROM crm_contacts WHERE id = $1"#)
        .bind(contact_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(h,)| h))
}

async fn fetch_company_updated_at(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<Option<chrono::DateTime<chrono::Utc>>> {
    let row: Option<(chrono::DateTime<chrono::Utc>,)> =
        sqlx::query_as(r#"SELECT updated_at FROM crm_companies WHERE id = $1"#)
            .bind(company_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(updated_at,)| updated_at))
}

async fn fetch_contact_updated_at(
    pool: &PgPool,
    contact_id: Uuid,
) -> sqlx::Result<Option<chrono::DateTime<chrono::Utc>>> {
    let row: Option<(chrono::DateTime<chrono::Utc>,)> =
        sqlx::query_as(r#"SELECT updated_at FROM crm_contacts WHERE id = $1"#)
            .bind(contact_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(updated_at,)| updated_at))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_none_when_no_company_for_domain(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo.get_company_by_domain(&team_id, "missing.com").await?;

    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_company_with_all_domains_when_match(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com", "acme.io"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let company = repo
        .get_company_by_domain(&team_id, "acme.com")
        .await?
        .expect("company should be returned");

    assert_eq!(company.id, company_id);
    assert_eq!(company.team_id, team_id);
    assert!(company.email_sync);

    let mut domains: Vec<_> = company.domains.iter().map(|d| d.domain.as_str()).collect();
    domains.sort();
    assert_eq!(domains, vec!["acme.com", "acme.io"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn domain_lookup_is_case_insensitive(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);

    assert!(
        repo.get_company_by_domain(&team_id, "ACME.COM")
            .await?
            .is_some()
    );
    assert!(
        repo.get_company_by_domain(&team_id, "Acme.Com")
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn does_not_return_companies_from_other_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner_a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner_b@test.com").await?;
    insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo.get_company_by_domain(&team_b, "acme.com").await?;

    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_company_when_email_sync_is_false(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    insert_company(&pool, team_id, false, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let company = repo
        .get_company_by_domain(&team_id, "acme.com")
        .await?
        .expect("company should be returned");

    assert!(!company.email_sync);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_disable_clears_contacts_and_sources(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;

    assert_eq!(count_contacts(&pool, company_id).await?, 2);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 2);

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_email_sync(&team_id, &company_id, false).await?;

    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    assert_eq!(count_contacts(&pool, company_id).await?, 0);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_enable_preserves_contacts(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    // Start disabled with a lingering contact — re-enabling must NOT touch it.
    let company_id = insert_company(&pool, team_id, false, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_email_sync(&team_id, &company_id, true).await?;

    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(true));
    assert_eq!(count_contacts(&pool, company_id).await?, 1);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_returns_not_found_for_unknown_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo.set_email_sync(&team_id, &Uuid::now_v7(), false).await;

    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_isolates_companies_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    let owner_a = "macro|owner_a@test.com";
    let owner_b = "macro|owner_b@test.com";
    seed_team(&pool, team_a, owner_a).await?;
    seed_team(&pool, team_b, owner_b).await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let link_a = insert_email_link(&pool, owner_a, "a@macro.test").await?;
    insert_contact_with_source(&pool, company_a, "alice@acme.com", link_a).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // team_b mutating team_a's company must fail without touching the row.
    let result = repo.set_email_sync(&team_b, &company_a, false).await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));

    assert_eq!(fetch_email_sync(&pool, company_a).await?, Some(true));
    assert_eq!(count_contacts(&pool, company_a).await?, 1);
    assert_eq!(count_sources_for_company(&pool, company_a).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_disable_handles_multi_domain_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id =
        insert_company(&pool, team_id, true, &["acme.com", "acme.io", "acme.co"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    insert_contact_with_source(&pool, company_id, "bob@acme.io", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_email_sync(&team_id, &company_id, false).await?;

    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    assert_eq!(count_contacts(&pool, company_id).await?, 0);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 0);
    // Company + its domain rows survive the disable so future populates short-circuit.
    let (domain_count,): (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM crm_domains WHERE company_id = $1"#)
            .bind(company_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(domain_count, 3);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_toggles_flag(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_hidden(&team_id, &company_id, true).await?;
    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(true));

    repo.set_company_hidden(&team_id, &company_id, false)
        .await?;
    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_returns_not_found_for_unknown_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .set_company_hidden(&team_id, &Uuid::now_v7(), true)
        .await;

    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_isolates_companies_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner_a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner_b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let result = repo.set_company_hidden(&team_b, &company_a, true).await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    assert_eq!(fetch_company_hidden(&pool, company_a).await?, Some(false));
    Ok(())
}

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
async fn set_email_sync_enable_refuses_hidden_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, false, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let result = repo.set_email_sync(&team_id, &company_id, true).await;

    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyHidden)
    ));
    // State must be unchanged.
    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(true));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_disable_allowed_on_hidden_company(pool: PgPool) -> anyhow::Result<()> {
    // Disabling sync on an already-hidden, already-disabled company is
    // a no-op-shaped call but must not error — the hidden check only
    // fires on the enable path.
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, false, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_email_sync(&team_id, &company_id, false).await?;

    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(true));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_set_company_hidden_true_also_disables_email_sync(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    service
        .set_company_hidden(&team_id, &company_id, true)
        .await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(true));
    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    assert_eq!(count_contacts(&pool, company_id).await?, 0);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_set_company_hidden_false_does_not_re_enable_email_sync(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    // Start with hidden=true (via service, which also flipped sync off) then un-hide.
    let company_id = insert_company(&pool, team_id, false, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    service
        .set_company_hidden(&team_id, &company_id, false)
        .await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));
    // Un-hiding leaves email_sync alone — caller must re-enable it explicitly.
    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
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

async fn enable_crm_for_team(pool: &PgPool, team_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, TRUE)
           ON CONFLICT (team_id) DO UPDATE SET crm_enabled = TRUE"#,
    )
    .bind(team_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn count_companies_for_domain(
    pool: &PgPool,
    team_id: Uuid,
    domain: &str,
) -> sqlx::Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM crm_companies c
           JOIN crm_domains d ON d.company_id = c.id
           WHERE c.team_id = $1 AND LOWER(d.domain) = LOWER($2)"#,
    )
    .bind(team_id)
    .bind(domain)
    .fetch_one(pool)
    .await?;
    Ok(count)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_populate_contact_skips_when_domain_matches_user_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "colleague@macro.com",
            None,
        )
        .await?;

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "macro.com").await?,
        0,
        "contact on the user's own domain must not create a CRM row"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_populate_contact_same_domain_check_is_case_insensitive(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "User@MACRO.com").await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    service
        .populate_contact(
            &team_id,
            &link_id,
            "User@MACRO.com",
            "colleague@macro.com",
            None,
        )
        .await?;

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "macro.com").await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_populate_contact_refreshes_existing_company_and_contact_updated_at(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let old_updated_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar(r#"SELECT now() - INTERVAL '1 hour'"#)
            .fetch_one(&pool)
            .await?;

    let company_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_companies (id, team_id, email_sync, updated_at)
           VALUES ($1, $2, TRUE, $3)"#,
    )
    .bind(company_id)
    .bind(team_id)
    .bind(old_updated_at)
    .execute(&pool)
    .await?;

    sqlx::query(r#"INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)"#)
        .bind(company_id)
        .bind(team_id)
        .bind("acme.com")
        .execute(&pool)
        .await?;

    let contact_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, updated_at)
           VALUES ($1, $2, $3, $4)"#,
    )
    .bind(contact_id)
    .bind(company_id)
    .bind("alice@acme.com")
    .bind(old_updated_at)
    .execute(&pool)
    .await?;

    sqlx::query(r#"INSERT INTO crm_contact_sources (contact_id, link_id) VALUES ($1, $2)"#)
        .bind(contact_id)
        .bind(link_id)
        .execute(&pool)
        .await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            Some("Alice"),
        )
        .await?;

    let company_updated_at = fetch_company_updated_at(&pool, company_id)
        .await?
        .expect("company should still exist");
    let contact_updated_at = fetch_contact_updated_at(&pool, contact_id)
        .await?
        .expect("contact should still exist");

    assert!(company_updated_at > old_updated_at);
    assert!(contact_updated_at > old_updated_at);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_populate_contact_writes_when_domain_differs(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    service
        .populate_contact(&team_id, &link_id, "user@macro.com", "alice@acme.com", None)
        .await?;

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn precheck_reports_killswitch_off_when_settings_missing(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    // intentionally no team_crm_settings row

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .crm_scope_precheck(&team, &["acme.com".to_string()], &[])
        .await?;
    // Killswitch off short-circuits: the email service rejects with
    // CrmDisabledForTeam regardless of per-input state, so the probes
    // are skipped and per-input rows come back empty.
    assert!(!result.crm_enabled);
    assert!(result.domains.is_empty());
    assert!(result.addresses.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn precheck_resolves_domain_with_company_state(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    insert_company(&pool, team, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .crm_scope_precheck(
            &team,
            &["acme.com".to_string(), "missing.com".to_string()],
            &[],
        )
        .await?;
    assert!(result.crm_enabled);
    assert_eq!(result.domains.len(), 2);

    let acme = result
        .domains
        .iter()
        .find(|d| d.domain == "acme.com")
        .unwrap();
    assert!(acme.exists);
    assert!(!acme.company_hidden);
    assert!(acme.email_sync);

    let missing = result
        .domains
        .iter()
        .find(|d| d.domain == "missing.com")
        .unwrap();
    assert!(!missing.exists);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn precheck_reports_hidden_and_email_sync_disabled_companies(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let hidden_co = insert_company(&pool, team, false, &["hidden.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(hidden_co)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .crm_scope_precheck(&team, &["hidden.com".to_string()], &[])
        .await?;
    let d = &result.domains[0];
    assert!(d.exists);
    assert!(d.company_hidden);
    assert!(!d.email_sync);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn precheck_address_resolves_contact_within_team(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["acme.com"]).await?;
    let link = insert_email_link(&pool, owner, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company, "alice@acme.com", link).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .crm_scope_precheck(
            &team,
            &[],
            &["alice@acme.com".to_string(), "bob@acme.com".to_string()],
        )
        .await?;

    let alice = result
        .addresses
        .iter()
        .find(|a| a.address == "alice@acme.com")
        .unwrap();
    assert!(alice.exists);
    assert!(!alice.contact_hidden);
    assert!(!alice.company_hidden);
    assert!(alice.email_sync);

    let bob = result
        .addresses
        .iter()
        .find(|a| a.address == "bob@acme.com")
        .unwrap();
    assert!(!bob.exists);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn precheck_address_does_not_leak_other_team_contacts(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    let owner_a = "macro|owner_a@test.com";
    let owner_b = "macro|owner_b@test.com";
    seed_team(&pool, team_a, owner_a).await?;
    seed_team(&pool, team_b, owner_b).await?;
    enable_crm_for_team(&pool, team_b).await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let link_a = insert_email_link(&pool, owner_a, "a@macro.test").await?;
    insert_contact_with_source(&pool, company_a, "alice@acme.com", link_a).await?;

    // team_b asks about an address that only exists under team_a — must
    // report as non-existent, not leak team_a's contact state.
    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .crm_scope_precheck(&team_b, &[], &["alice@acme.com".to_string()])
        .await?;
    assert!(!result.addresses[0].exists);
    Ok(())
}
