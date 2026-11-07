use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::CrmCompanySummary;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// The company summary in a contact's detail.
async fn summary_of(
    repo: &CompaniesRepositoryImpl,
    team_id: Uuid,
    contact_id: Uuid,
    include_hidden: bool,
) -> anyhow::Result<Option<CrmCompanySummary>> {
    let detail = repo
        .get_contact_detail_for_team(&team_id, &contact_id, include_hidden)
        .await?
        .expect("contact should be returned");
    Ok(detail.company)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_is_the_contact_read_with_the_company_named_as_the_company_read_names_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com", "acmecorp.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "ada@example.com").await?;
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
            let detail = repo
                .get_contact_detail_for_team(&team_id, &contact_id, false)
                .await?
                .expect("detail should be returned");
            let contact = repo
                .get_contact_for_team(&team_id, &contact_id, false)
                .await?
                .expect("contact should be returned");
            let company = repo
                .get_company_for_team(&team_id, &company_id, false, false)
                .await?
                .expect("company should be returned");
            let domain = company.company.domains.first().map(|d| d.domain.clone());
            anyhow::Ok((detail, contact, company.name, domain))
        }
    };

    let (detail, contact, name, domain) = read(&repo).await?;
    assert_eq!(
        serde_json::to_value(&detail.contact)?,
        serde_json::to_value(&contact)?
    );
    let summary = detail.company.expect("summary should be returned");
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
    let (detail, _, name, _) = read(&repo).await?;
    let summary = detail.company.expect("summary should be returned");
    assert_eq!(summary.name.as_deref(), Some("Acme"));
    assert_eq!(summary.name, name);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_summary_of_a_company_without_a_name_falls_back_to_its_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let unnamed = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let domainless = insert_company(&pool, team_id, true, &[]).await?;
    let in_unnamed = insert_contact(&pool, unnamed, "ada@example.com").await?;
    let in_domainless = insert_contact(&pool, domainless, "bob@example.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    for (contact_id, domain) in [(in_unnamed, Some("acme.com")), (in_domainless, None)] {
        let summary = summary_of(&repo, team_id, contact_id, false)
            .await?
            .expect("summary should be returned");
        assert_eq!(summary.name, None);
        assert_eq!(summary.domain.as_deref(), domain);
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_summary_breaks_a_created_at_tie_by_domain_id(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let company_id = insert_company(&pool, team_id, true, &[]).await?;
    let contact_id = insert_contact(&pool, company_id, "ada@example.com").await?;
    // The smaller id goes in second, so insertion order can't stand in for
    // the tie-break.
    for (id, domain) in [
        ("00000000-0000-7000-8000-000000000002", "zeta.com"),
        ("00000000-0000-7000-8000-000000000001", "alpha.com"),
    ] {
        sqlx::query(
            r#"INSERT INTO crm_domains (id, company_id, team_id, domain, created_at)
               VALUES ($1::uuid, $2, $3, $4, '2026-01-01T00:00:00Z')"#,
        )
        .bind(id)
        .bind(company_id)
        .bind(team_id)
        .bind(domain)
        .execute(&pool)
        .await?;
    }

    let repo = CompaniesRepositoryImpl::new(pool);
    let summary = summary_of(&repo, team_id, contact_id, false)
        .await?
        .expect("summary should be returned");
    assert_eq!(summary.domain.as_deref(), Some("alpha.com"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_of_a_contact_without_a_company_has_no_summary(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let contact_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, team_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, 'ada@example.com', now(), now())"#,
    )
    .bind(contact_id)
    .bind(team_id)
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert_eq!(summary_of(&repo, team_id, contact_id, false).await?, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_under_a_hidden_company_is_for_admins_only(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "ada@example.com").await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_contact_detail_for_team(&team_id, &contact_id, false)
            .await?
            .is_none()
    );
    let admin = summary_of(&repo, team_id, contact_id, true)
        .await?
        .expect("admin should see a hidden company");
    assert!(admin.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn detail_does_not_leak_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@example.com").await?;
    seed_team(&pool, team_b, "macro|b@example.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let contact_a = insert_contact(&pool, company_a, "ada@example.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_contact_detail_for_team(&team_b, &contact_a, true)
            .await?
            .is_none()
    );
    Ok(())
}
