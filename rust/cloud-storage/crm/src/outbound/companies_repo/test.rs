use super::*;
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
    name: &str,
    email_sync: bool,
    domains: &[&str],
) -> sqlx::Result<Uuid> {
    let company_id = Uuid::now_v7();

    sqlx::query(
        r#"INSERT INTO crm_companies (id, team_id, name, email_sync) VALUES ($1, $2, $3, $4)"#,
    )
    .bind(company_id)
    .bind(team_id)
    .bind(name)
    .bind(email_sync)
    .execute(pool)
    .await?;

    for domain in domains {
        sqlx::query(r#"INSERT INTO crm_domains (company_id, domain) VALUES ($1, $2)"#)
            .bind(company_id)
            .bind(*domain)
            .execute(pool)
            .await?;
    }

    Ok(company_id)
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
    let company_id = insert_company(&pool, team_id, "Acme", true, &["acme.com", "acme.io"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let company = repo
        .get_company_by_domain(&team_id, "acme.com")
        .await?
        .expect("company should be returned");

    assert_eq!(company.id, company_id);
    assert_eq!(company.team_id, team_id);
    assert_eq!(company.name, "Acme");
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
    insert_company(&pool, team_id, "Acme", true, &["acme.com"]).await?;

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
    insert_company(&pool, team_a, "Acme A", true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo.get_company_by_domain(&team_b, "acme.com").await?;

    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_company_when_email_sync_is_false(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    insert_company(&pool, team_id, "Acme", false, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let company = repo
        .get_company_by_domain(&team_id, "acme.com")
        .await?
        .expect("company should be returned");

    assert!(!company.email_sync);
    Ok(())
}
