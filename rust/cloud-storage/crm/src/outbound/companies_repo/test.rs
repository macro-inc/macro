use super::*;
use crate::domain::comment::CrmCommentEntityType;
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

    sqlx::query(
        r#"INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
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
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
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

async fn fetch_company_interactions(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>> {
    sqlx::query_as(r#"SELECT first_interaction, last_interaction FROM crm_companies WHERE id = $1"#)
        .bind(company_id)
        .fetch_optional(pool)
        .await
}

async fn fetch_contact_interactions(
    pool: &PgPool,
    contact_id: Uuid,
) -> sqlx::Result<Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>> {
    sqlx::query_as(r#"SELECT first_interaction, last_interaction FROM crm_contacts WHERE id = $1"#)
        .bind(contact_id)
        .fetch_optional(pool)
        .await
}

async fn fetch_company_for_domain(
    pool: &PgPool,
    team_id: Uuid,
    domain: &str,
) -> sqlx::Result<Option<Uuid>> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"SELECT c.id
           FROM crm_companies c
           JOIN crm_domains d ON d.company_id = c.id
           WHERE c.team_id = $1 AND LOWER(d.domain) = LOWER($2)
           LIMIT 1"#,
    )
    .bind(team_id)
    .bind(domain)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

async fn fetch_contact_id(
    pool: &PgPool,
    company_id: Uuid,
    email: &str,
) -> sqlx::Result<Option<Uuid>> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"SELECT id FROM crm_contacts WHERE company_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1"#,
    )
    .bind(company_id)
    .bind(email)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
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
            chrono::Utc::now(),
            chrono::Utc::now(),
            true,
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
            chrono::Utc::now(),
            chrono::Utc::now(),
            true,
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
        r#"INSERT INTO crm_companies (id, team_id, email_sync, updated_at, first_interaction, last_interaction)
           VALUES ($1, $2, TRUE, $3, $3, $3)"#,
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
        r#"INSERT INTO crm_contacts (id, company_id, email, updated_at, first_interaction, last_interaction)
           VALUES ($1, $2, $3, $4, $4, $4)"#,
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
            chrono::Utc::now(),
            chrono::Utc::now(),
            true,
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
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            chrono::Utc::now(),
            chrono::Utc::now(),
            true,
        )
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

/// Received-direction populate for an unknown `(team, domain)` is a
/// no-op: only sent-direction may create a new `crm_companies` row.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_is_sent_false_skips_when_no_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    let now = chrono::Utc::now();
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            now,
            now,
            false,
        )
        .await?;

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        0,
        "received-direction populate must not create a crm_companies row"
    );
    Ok(())
}

/// Brand-new company + contact INSERT writes `first_interaction` and
/// `last_interaction` directly from the payload's distinct `first_at` /
/// `last_at` (covers the historical-seed range, e.g. 2020→2024).
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_insert_seeds_first_and_last_from_payload(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let first: chrono::DateTime<chrono::Utc> = "2020-01-01T00:00:00Z".parse()?;
    let last: chrono::DateTime<chrono::Utc> = "2024-06-15T00:00:00Z".parse()?;

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
            None,
            first,
            last,
            true,
        )
        .await?;

    let company_id = fetch_company_for_domain(&pool, team_id, "acme.com")
        .await?
        .expect("company should be inserted");
    let (company_first, company_last) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("company interactions");
    assert_eq!(company_first, first);
    assert_eq!(company_last, last);

    let contact_id = fetch_contact_id(&pool, company_id, "alice@acme.com")
        .await?
        .expect("contact should be inserted");
    let (contact_first, contact_last) = fetch_contact_interactions(&pool, contact_id)
        .await?
        .expect("contact interactions");
    assert_eq!(contact_first, first);
    assert_eq!(contact_last, last);
    Ok(())
}

/// Sent-direction populate against an existing row merges
/// `first_interaction` via `LEAST` (older message pulls it back) and
/// `last_interaction` via `GREATEST` (newer message pushes it forward),
/// on both the company and contact rows.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_is_sent_true_merges_first_least_and_last_greatest(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let initial: chrono::DateTime<chrono::Utc> = "2022-06-01T00:00:00Z".parse()?;
    let older: chrono::DateTime<chrono::Utc> = "2020-01-01T00:00:00Z".parse()?;
    let newer: chrono::DateTime<chrono::Utc> = "2024-12-31T00:00:00Z".parse()?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    // First populate establishes the row at `initial`.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            initial,
            initial,
            true,
        )
        .await?;

    let company_id = fetch_company_for_domain(&pool, team_id, "acme.com")
        .await?
        .expect("company");
    let contact_id = fetch_contact_id(&pool, company_id, "alice@acme.com")
        .await?
        .expect("contact");

    // A backfilled older message should pull first_interaction back via LEAST.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            older,
            older,
            true,
        )
        .await?;

    let (company_first, company_last) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("interactions");
    assert_eq!(company_first, older);
    assert_eq!(company_last, initial);
    let (contact_first, contact_last) = fetch_contact_interactions(&pool, contact_id)
        .await?
        .expect("interactions");
    assert_eq!(contact_first, older);
    assert_eq!(contact_last, initial);

    // A newer message should push last_interaction forward via GREATEST,
    // leaving first_interaction at `older`.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            newer,
            newer,
            true,
        )
        .await?;

    let (company_first, company_last) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("interactions");
    assert_eq!(company_first, older);
    assert_eq!(company_last, newer);
    Ok(())
}

/// Received-direction populate against an existing row must not pull
/// `first_interaction` backwards — even with an older timestamp — but
/// still GREATEST-merges `last_interaction` when newer. Asserts both
/// company and contact.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_is_sent_false_leaves_first_interaction_unchanged(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let baseline: chrono::DateTime<chrono::Utc> = "2022-06-01T00:00:00Z".parse()?;
    let older: chrono::DateTime<chrono::Utc> = "2020-01-01T00:00:00Z".parse()?;
    let newer: chrono::DateTime<chrono::Utc> = "2024-12-31T00:00:00Z".parse()?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    // Sent populate seeds the row at `baseline`.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            baseline,
            baseline,
            true,
        )
        .await?;

    let company_id = fetch_company_for_domain(&pool, team_id, "acme.com")
        .await?
        .expect("company");
    let contact_id = fetch_contact_id(&pool, company_id, "alice@acme.com")
        .await?
        .expect("contact");

    // Received populate with an older timestamp must NOT pull
    // first_interaction backwards on either row.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            older,
            older,
            false,
        )
        .await?;

    let (company_first, _) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("interactions");
    assert_eq!(
        company_first, baseline,
        "received populate must not pull company first_interaction backwards"
    );
    let (contact_first, _) = fetch_contact_interactions(&pool, contact_id)
        .await?
        .expect("interactions");
    assert_eq!(
        contact_first, baseline,
        "received populate must not pull contact first_interaction backwards"
    );

    // Received populate with a newer timestamp still bumps last_interaction.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            newer,
            newer,
            false,
        )
        .await?;

    let (_, company_last) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("interactions");
    assert_eq!(company_last, newer);
    let (_, contact_last) = fetch_contact_interactions(&pool, contact_id)
        .await?
        .expect("interactions");
    assert_eq!(contact_last, newer);
    Ok(())
}

/// Received-direction populate at a known company creates a new
/// `crm_contacts` row (seeded with both timestamps) and a
/// `crm_contact_sources` row — verifying sources now track
/// interactions in both directions.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_is_sent_false_inserts_contact_at_existing_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let baseline: chrono::DateTime<chrono::Utc> = "2022-06-01T00:00:00Z".parse()?;
    let received_at: chrono::DateTime<chrono::Utc> = "2024-09-15T00:00:00Z".parse()?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    // Sent populate establishes the company via alice@acme.com.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            baseline,
            baseline,
            true,
        )
        .await?;

    let company_id = fetch_company_for_domain(&pool, team_id, "acme.com")
        .await?
        .expect("company");
    assert_eq!(count_contacts(&pool, company_id).await?, 1);

    // Received-direction populate for a *new* address at the same
    // company creates a contact row + source row.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "bob@acme.com",
            Some("Bob"),
            received_at,
            received_at,
            false,
        )
        .await?;

    assert_eq!(
        count_contacts(&pool, company_id).await?,
        2,
        "received-direction populate must insert a contact under the known company"
    );
    let bob_id = fetch_contact_id(&pool, company_id, "bob@acme.com")
        .await?
        .expect("bob contact");
    let (bob_first, bob_last) = fetch_contact_interactions(&pool, bob_id)
        .await?
        .expect("bob interactions");
    assert_eq!(bob_first, received_at);
    assert_eq!(bob_last, received_at);
    assert_eq!(
        count_sources_for_company(&pool, company_id).await?,
        2,
        "received-direction populate must write a crm_contact_sources row"
    );
    Ok(())
}

/// Team-level CRM killswitch (`team_crm_settings.crm_enabled = false`
/// or missing) short-circuits populate in both directions before any
/// rows are written.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_team_killswitch_off_noops_both_directions(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    // Intentionally do NOT enable_crm_for_team — team_crm_settings row is
    // missing, which is treated as crm_enabled = false.
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    let now = chrono::Utc::now();

    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            now,
            now,
            true,
        )
        .await?;
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            now,
            now,
            false,
        )
        .await?;

    assert_eq!(
        count_companies_for_domain(&pool, team_id, "acme.com").await?,
        0,
        "team killswitch must short-circuit both directions"
    );
    Ok(())
}

/// Per-domain killswitch (`crm_companies.email_sync = false`)
/// short-circuits populate in both directions: interaction columns
/// stay at the stored baseline and no contact / source rows land.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_per_domain_killswitch_noops_both_directions(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    // Seed a killswitched company for the domain. Baseline timestamp
    // is parsed from a string so it has zero sub-microsecond precision
    // — Postgres `TIMESTAMPTZ` only stores microseconds, and
    // `chrono::Utc::now()` would carry nanos that get silently
    // truncated and break the `assert_eq` below.
    let company_id = insert_company(&pool, team_id, false, &["acme.com"]).await?;
    let baseline: chrono::DateTime<chrono::Utc> = "2024-01-01T00:00:00Z".parse()?;
    sqlx::query(
        r#"UPDATE crm_companies
           SET first_interaction = $2, last_interaction = $2
           WHERE id = $1"#,
    )
    .bind(company_id)
    .bind(baseline)
    .execute(&pool)
    .await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    let later: chrono::DateTime<chrono::Utc> = "2024-01-08T00:00:00Z".parse()?;

    for is_sent in [true, false] {
        service
            .populate_contact(
                &team_id,
                &link_id,
                "user@macro.com",
                "alice@acme.com",
                None,
                later,
                later,
                is_sent,
            )
            .await?;
    }

    // Killswitch must keep the company's interaction columns at the
    // baseline and prevent contact / source inserts.
    let (first, last) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("company");
    assert_eq!(first, baseline);
    assert_eq!(last, baseline);
    assert_eq!(count_contacts(&pool, company_id).await?, 0);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 0);
    Ok(())
}

/// Historical-seed-style populate (`first_at != last_at`) against an
/// already-tracked row expands the stored range outward: `first` pulls
/// back via LEAST and `last` pushes forward via GREATEST in the same
/// call.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn populate_contact_seed_style_range_merges_into_existing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;

    let baseline: chrono::DateTime<chrono::Utc> = "2022-06-01T00:00:00Z".parse()?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );

    // Establish the rows at `baseline`.
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            baseline,
            baseline,
            true,
        )
        .await?;

    let company_id = fetch_company_for_domain(&pool, team_id, "acme.com")
        .await?
        .expect("company");
    let contact_id = fetch_contact_id(&pool, company_id, "alice@acme.com")
        .await?
        .expect("contact");

    // Historical-seed-style populate: distinct first_at < last_at,
    // is_sent=true, hitting an already-populated contact. Should pull
    // first_interaction earlier AND push last_interaction later.
    let seed_first: chrono::DateTime<chrono::Utc> = "2010-03-15T00:00:00Z".parse()?;
    let seed_last: chrono::DateTime<chrono::Utc> = "2024-12-31T00:00:00Z".parse()?;
    service
        .populate_contact(
            &team_id,
            &link_id,
            "user@macro.com",
            "alice@acme.com",
            None,
            seed_first,
            seed_last,
            true,
        )
        .await?;

    let (company_first, company_last) = fetch_company_interactions(&pool, company_id)
        .await?
        .expect("interactions");
    assert_eq!(company_first, seed_first);
    assert_eq!(company_last, seed_last);
    let (contact_first, contact_last) = fetch_contact_interactions(&pool, contact_id)
        .await?
        .expect("interactions");
    assert_eq!(contact_first, seed_first);
    assert_eq!(contact_last, seed_last);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_empty_when_killswitch_missing(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    // No team_crm_settings row → killswitch defaults to off.
    insert_company(&pool, team, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, None, 100)
        .await?;
    assert!(
        result.is_empty(),
        "killswitch missing must short-circuit to empty list even when companies exist"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_empty_when_killswitch_off(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    sqlx::query(r#"INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, FALSE)"#)
        .bind(team)
        .execute(&pool)
        .await?;
    insert_company(&pool, team, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, None, 100)
        .await?;
    assert!(result.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_excludes_hidden_rows(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let visible = insert_company(&pool, team, true, &["acme.com"]).await?;
    let hidden = insert_company(&pool, team, true, &["zeta.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(hidden)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, None, 100)
        .await?;
    let ids: Vec<Uuid> = result.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![visible], "hidden = TRUE rows must not appear");
    // The visible row must have its domains hydrated.
    assert_eq!(result[0].company.domains.len(), 1);
    assert_eq!(result[0].company.domains[0].domain, "acme.com");
    // No directory row for acme.com — both display fields should be None.
    assert_eq!(result[0].name, None);
    assert_eq!(result[0].description, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_hidden_when_hidden_true(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let visible = insert_company(&pool, team, true, &["acme.com"]).await?;
    let hidden = insert_company(&pool, team, true, &["zeta.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(hidden)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);

    let hidden_only = repo
        .list_companies_for_soup(
            &team,
            &[],
            Some(true),
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = hidden_only.iter().map(|c| c.company.id).collect();
    assert_eq!(
        ids,
        vec![hidden],
        "hidden=Some(true) must return only hidden rows"
    );

    let visible_only_explicit = repo
        .list_companies_for_soup(
            &team,
            &[],
            Some(false),
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = visible_only_explicit.iter().map(|c| c.company.id).collect();
    assert_eq!(
        ids,
        vec![visible],
        "hidden=Some(false) must behave the same as None (visible only)",
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_hydrates_name_and_description_from_directory(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    insert_company(&pool, team, true, &["acme.com", "acmecorp.com"]).await?;
    // Directory row only on the primary — secondary must not be picked.
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description)
           VALUES ($1, $2, $3)"#,
    )
    .bind("acme.com")
    .bind("Acme Inc.")
    .bind("Maker of rocket-powered roller skates.")
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, None, 100)
        .await?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name.as_deref(), Some("Acme Inc."));
    assert_eq!(
        result[0].description.as_deref(),
        Some("Maker of rocket-powered roller skates.")
    );
    // Domain order is by created_at ASC; both should be present.
    assert_eq!(result[0].company.domains.len(), 2);
    assert_eq!(result[0].company.domains[0].domain, "acme.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_none_for_negative_cache_directory_row(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Negative-cache directory row (NULL name/description) → soup
    // surfaces as None, not Some("").
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    insert_company(&pool, team, true, &["acme.com"]).await?;
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description)
           VALUES ($1, NULL, NULL)"#,
    )
    .bind("acme.com")
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, None, 100)
        .await?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, None);
    assert_eq!(result[0].description, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_filters_by_company_ids_when_non_empty(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let wanted = insert_company(&pool, team, true, &["acme.com"]).await?;
    let _other = insert_company(&pool, team, true, &["zeta.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team,
            &[wanted],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = result.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![wanted]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_does_not_leak_other_team_rows(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    enable_crm_for_team(&pool, team_a).await?;
    enable_crm_for_team(&pool, team_b).await?;
    insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let b_only = insert_company(&pool, team_b, true, &["zeta.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(&team_b, &[], None, CrmCompanyListSort::UpdatedAt, None, 100)
        .await?;
    let ids: Vec<Uuid> = result.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![b_only]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_paginates_past_cursor(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team).await?;

    // Five companies with strictly increasing interaction timestamps.
    // Parsed (not `now()`) so they carry no sub-microsecond precision
    // that Postgres would truncate out from under the cursor compare.
    let mut companies = Vec::new();
    for day in 1..=5 {
        let domain = format!("c{day}.com");
        let id = insert_company(&pool, team, true, &[domain.as_str()]).await?;
        let ts: chrono::DateTime<chrono::Utc> = format!("2024-01-0{day}T00:00:00Z").parse()?;
        sqlx::query(
            r#"UPDATE crm_companies
               SET first_interaction = $2, last_interaction = $2
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(ts)
        .execute(&pool)
        .await?;
        companies.push(id);
    }
    // Descending by timestamp → newest (day 5) first.
    let expected: Vec<Uuid> = companies.iter().rev().copied().collect();

    let repo = CompaniesRepositoryImpl::new(pool);

    // Walk every page with limit=2, threading the keyset cursor from the
    // last row of each page — exactly how the soup paginator drives it.
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<CrmCompanySoupCursor> = None;
    let mut first_page: Vec<Uuid> = Vec::new();
    for page_idx in 0..10 {
        let page = repo
            .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, cursor, 2)
            .await?;
        if page.is_empty() {
            break;
        }
        let page_ids: Vec<Uuid> = page.iter().map(|c| c.company.id).collect();
        if page_idx == 0 {
            first_page = page_ids.clone();
        } else {
            // Regression: a follow-up page must not re-serve page one.
            // (The pre-fix query ignored the cursor and always did this.)
            assert_ne!(
                page_ids, first_page,
                "cursor did not advance — page {page_idx} repeated the first page"
            );
        }
        let last = page.last().unwrap();
        cursor = Some(CrmCompanySoupCursor {
            last_sort_ts: last.company.updated_at,
            last_id: last.company.id,
        });
        let exhausted = page.len() < 2;
        seen.extend(page_ids);
        if exhausted {
            break;
        }
    }

    assert_eq!(
        seen, expected,
        "pagination must yield every company exactly once in descending interaction order"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_pagination_breaks_ties_on_id(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team).await?;

    // One newest company, then a tied pair, then two older. At limit=2
    // the tied pair straddles the page-1/page-2 boundary, so pagination
    // must lean on the `id` half of the keyset — a timestamp-only seek
    // would skip the second tied row (its ts is not `< cursor_ts`).
    let newest: chrono::DateTime<chrono::Utc> = "2024-01-05T00:00:00Z".parse()?;
    let tie: chrono::DateTime<chrono::Utc> = "2024-01-04T00:00:00Z".parse()?;
    let mid: chrono::DateTime<chrono::Utc> = "2024-01-03T00:00:00Z".parse()?;
    let oldest: chrono::DateTime<chrono::Utc> = "2024-01-02T00:00:00Z".parse()?;

    let mut want: Vec<(chrono::DateTime<chrono::Utc>, Uuid)> = Vec::new();
    for (idx, ts) in [newest, tie, tie, mid, oldest].into_iter().enumerate() {
        let domain = format!("tie{idx}.com");
        let id = insert_company(&pool, team, true, &[domain.as_str()]).await?;
        sqlx::query(
            r#"UPDATE crm_companies
               SET first_interaction = $2, last_interaction = $2
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(ts)
        .execute(&pool)
        .await?;
        want.push((ts, id));
    }
    // Expected DB order: last_interaction DESC, then id DESC. Computed
    // from the ids actually generated, so it holds regardless of which
    // tied row drew the larger uuid.
    want.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let expected: Vec<Uuid> = want.iter().map(|(_, id)| *id).collect();

    let repo = CompaniesRepositoryImpl::new(pool);
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<CrmCompanySoupCursor> = None;
    for _ in 0..10 {
        let page = repo
            .list_companies_for_soup(&team, &[], None, CrmCompanyListSort::UpdatedAt, cursor, 2)
            .await?;
        if page.is_empty() {
            break;
        }
        let last = page.last().unwrap();
        cursor = Some(CrmCompanySoupCursor {
            last_sort_ts: last.company.updated_at,
            last_id: last.company.id,
        });
        let exhausted = page.len() < 2;
        seen.extend(page.iter().map(|c| c.company.id));
        if exhausted {
            break;
        }
    }

    assert_eq!(
        seen, expected,
        "tied timestamps must paginate by id without skipping or repeating across the boundary"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_returns_visible_ordered_alphabetically(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;

    // Named contacts sort by name; a name-less contact sorts by email.
    // `anna smith` is lowercased to confirm the sort is case-insensitive.
    let zoe = insert_contact_with_source(&pool, company_id, "zoe@acme.com", link_id).await?;
    let mike = insert_contact_with_source(&pool, company_id, "mike@acme.com", link_id).await?;
    let carol = insert_contact_with_source(&pool, company_id, "carol@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_contacts SET name = 'Zoe Adams' WHERE id = $1"#)
        .bind(zoe)
        .execute(&pool)
        .await?;
    sqlx::query(r#"UPDATE crm_contacts SET name = 'anna smith' WHERE id = $1"#)
        .bind(carol)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let contacts = repo
        .list_contacts_for_company(&team_id, &company_id)
        .await?;
    let ids: Vec<Uuid> = contacts.iter().map(|c| c.id).collect();
    // "anna smith" (carol) < "mike@acme.com" (mike) < "zoe adams" (zoe)
    assert_eq!(ids, vec![carol, mike, zoe]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_excludes_hidden(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let visible = insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    let hidden = insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#)
        .bind(hidden)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let contacts = repo
        .list_contacts_for_company(&team_id, &company_id)
        .await?;
    let ids: Vec<Uuid> = contacts.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![visible]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_owned_company_with_no_contacts_returns_empty(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let contacts = repo
        .list_contacts_for_company(&team_id, &company_id)
        .await?;
    assert!(contacts.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_unknown_company_returns_not_found(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_contacts_for_company(&team_id, &Uuid::now_v7())
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_does_not_leak_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let link_a = insert_email_link(&pool, "macro|a@test.com", "a@macro.test").await?;
    insert_contact_with_source(&pool, company_a, "alice@acme.com", link_a).await?;

    // Team B asking for team A's company must 404, not see an empty list.
    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo.list_contacts_for_company(&team_b, &company_a).await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

// ---------------------------------------------------------------------------
// CRM comment threads
// ---------------------------------------------------------------------------

/// Inserts a bare contact under `company_id` (no source row needed for the
/// comment tests).
async fn insert_contact(pool: &PgPool, company_id: Uuid, email: &str) -> sqlx::Result<Uuid> {
    let contact_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(contact_id)
    .bind(company_id)
    .bind(email)
    .execute(pool)
    .await?;
    Ok(contact_id)
}

/// Counts live (non-soft-deleted) threads.
async fn count_threads(pool: &PgPool) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM crm_thread WHERE deleted_at IS NULL"#)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_opens_thread_on_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "first comment",
            None,
        )
        .await?;

    assert_eq!(ct.thread.entity_type, CrmCommentEntityType::CrmCompany);
    assert_eq!(ct.thread.entity_id, company_id);
    assert_eq!(ct.thread.owner, owner);
    assert_eq!(ct.comments.len(), 1);
    assert_eq!(ct.comments[0].text, "first comment");
    assert_eq!(ct.comments[0].owner, owner);
    assert_eq!(ct.comments[0].thread_id, ct.thread.thread_id);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_opens_thread_on_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "alice@acme.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmContact,
            &contact_id,
            owner,
            None,
            None,
            "hi alice",
            None,
        )
        .await?;

    assert_eq!(ct.thread.entity_type, CrmCommentEntityType::CrmContact);
    assert_eq!(ct.thread.entity_id, contact_id);
    assert_eq!(ct.comments.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_reply_appends_to_thread(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let root = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "root",
            None,
        )
        .await?;
    let thread_id = root.thread.thread_id;

    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        Some(thread_id),
        None,
        "reply",
        None,
    )
    .await?;

    // One thread, two comments, oldest-first.
    let threads = repo
        .get_crm_comment_threads(&team_id, CrmCommentEntityType::CrmCompany, &company_id)
        .await?;
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].thread.thread_id, thread_id);
    assert_eq!(threads[0].comments.len(), 2);
    assert_eq!(threads[0].comments[0].text, "root");
    assert_eq!(threads[0].comments[1].text, "reply");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_unknown_company_404(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &Uuid::now_v7(),
            owner,
            None,
            None,
            "x",
            None,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_cross_team_404(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    // Team B cannot comment on team A's company.
    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .create_crm_comment(
            &team_b,
            CrmCommentEntityType::CrmCompany,
            &company_a,
            "macro|b@test.com",
            None,
            None,
            "x",
            None,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_reply_to_foreign_thread_404(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_1 = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let company_2 = insert_company(&pool, team_id, true, &["beta.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let root = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_1,
            owner,
            None,
            None,
            "root",
            None,
        )
        .await?;

    // Replying with company_1's thread id but addressing company_2 must 404.
    let result = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_2,
            owner,
            Some(root.thread.thread_id),
            None,
            "reply",
            None,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::ThreadNotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_crm_comment_threads_empty_for_owned_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let threads = repo
        .get_crm_comment_threads(&team_id, CrmCommentEntityType::CrmCompany, &company_id)
        .await?;
    assert!(threads.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_crm_comment_threads_unknown_company_404(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_crm_comment_threads(&team_id, CrmCommentEntityType::CrmCompany, &Uuid::now_v7())
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edit_crm_comment_updates_text(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "before",
            None,
        )
        .await?;
    let comment_id = ct.comments[0].comment_id;

    let updated = repo
        .edit_crm_comment(&team_id, &comment_id, "after")
        .await?;
    assert_eq!(updated.text, "after");

    let threads = repo
        .get_crm_comment_threads(&team_id, CrmCommentEntityType::CrmCompany, &company_id)
        .await?;
    assert_eq!(threads[0].comments[0].text, "after");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edit_crm_comment_cross_team_404(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_a,
            CrmCommentEntityType::CrmCompany,
            &company_a,
            "macro|a@test.com",
            None,
            None,
            "secret",
            None,
        )
        .await?;

    let result = repo
        .edit_crm_comment(&team_b, &ct.comments[0].comment_id, "hacked")
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_removes_empty_thread(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "only comment",
            None,
        )
        .await?;

    let result = repo
        .delete_crm_comment(&team_id, &ct.comments[0].comment_id)
        .await?;
    assert!(result.thread_deleted);
    assert_eq!(result.thread_id, ct.thread.thread_id);
    assert_eq!(count_threads(&pool).await?, 0);

    let threads = repo
        .get_crm_comment_threads(&team_id, CrmCommentEntityType::CrmCompany, &company_id)
        .await?;
    assert!(threads.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_keeps_thread_with_remaining(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let root = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "root",
            None,
        )
        .await?;
    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        Some(root.thread.thread_id),
        None,
        "reply",
        None,
    )
    .await?;

    // Deleting the root leaves the thread alive with the reply.
    let result = repo
        .delete_crm_comment(&team_id, &root.comments[0].comment_id)
        .await?;
    assert!(!result.thread_deleted);

    let threads = repo
        .get_crm_comment_threads(&team_id, CrmCommentEntityType::CrmCompany, &company_id)
        .await?;
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].comments.len(), 1);
    assert_eq!(threads[0].comments[0].text, "reply");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_cross_team_404(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_a,
            CrmCommentEntityType::CrmCompany,
            &company_a,
            "macro|a@test.com",
            None,
            None,
            "secret",
            None,
        )
        .await?;

    let result = repo
        .delete_crm_comment(&team_b, &ct.comments[0].comment_id)
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_company_cascades_to_threads(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        None,
        None,
        "doomed",
        None,
    )
    .await?;
    assert_eq!(count_threads(&pool).await?, 1);

    // Hard-deleting the company cascades to its threads (and their comments).
    sqlx::query(r#"DELETE FROM crm_companies WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;
    assert_eq!(count_threads(&pool).await?, 0);
    Ok(())
}
