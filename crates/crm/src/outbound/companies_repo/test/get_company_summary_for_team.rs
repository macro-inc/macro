use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::CrmCompanySummary;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn summary_names_the_company_as_the_company_read_does(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com", "acmecorp.com"]).await?;
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name) VALUES ('acme.com', 'Acme Inc.'),
           ('acmecorp.com', 'Acme Corporation')"#,
    )
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let read = |repo: &CompaniesRepositoryImpl| {
        let repo = repo.clone();
        async move {
            let summary = repo
                .get_company_summary_for_team(&team_id, &company_id, false)
                .await?
                .expect("summary should be returned");
            let company = repo
                .get_company_for_team(&team_id, &company_id, false)
                .await?
                .expect("company should be returned");
            let domain = company.company.domains.first().map(|d| d.domain.clone());
            anyhow::Ok((summary, company.name, domain))
        }
    };

    let (summary, name, domain) = read(&repo).await?;
    assert_eq!(
        summary,
        CrmCompanySummary {
            id: company_id,
            name: Some("Acme Inc.".to_owned()),
            domain: Some("acme.com".to_owned()),
            hidden: false,
        }
    );
    assert_eq!(summary.name, name);
    assert_eq!(summary.domain, domain);

    sqlx::query(r#"UPDATE crm_companies SET custom_name = 'Acme' WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;
    let (summary, name, _) = read(&repo).await?;
    assert_eq!(summary.name.as_deref(), Some("Acme"));
    assert_eq!(summary.name, name);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn summary_of_a_company_without_a_name_falls_back_to_its_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let unnamed = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let domainless = insert_company(&pool, team_id, true, &[]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    for (company_id, domain) in [(unnamed, Some("acme.com")), (domainless, None)] {
        let summary = repo
            .get_company_summary_for_team(&team_id, &company_id, false)
            .await?
            .expect("summary should be returned");
        assert_eq!(summary.name, None);
        assert_eq!(summary.domain.as_deref(), domain);
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn summary_of_a_hidden_company_is_for_admins_only(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_company_summary_for_team(&team_id, &company_id, false)
            .await?
            .is_none()
    );
    let admin = repo
        .get_company_summary_for_team(&team_id, &company_id, true)
        .await?
        .expect("admin should see a hidden company");
    assert!(admin.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn summary_does_not_leak_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@example.com").await?;
    seed_team(&pool, team_b, "macro|b@example.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_company_summary_for_team(&team_b, &company_a, true)
            .await?
            .is_none()
    );
    Ok(())
}
