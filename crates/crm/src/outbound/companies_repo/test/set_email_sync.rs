use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_email_sync_disable_preserves_contacts_and_sources(pool: PgPool) -> anyhow::Result<()> {
    // Disabling email_sync only affects read-side visibility /
    // permission checks — it must not touch existing contacts.
    // Populate continues to write while sync is off; visibility is
    // controlled by `hidden`. Teams that want to drop contacts should
    // hide the company.
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let alice = insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    let bob = insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_email_sync(&team_id, &company_id, false).await?;

    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    // Contacts + sources stay put; their hidden state is untouched.
    assert_eq!(count_contacts(&pool, company_id).await?, 2);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 2);
    assert_eq!(fetch_contact_hidden(&pool, alice).await?, Some(false));
    assert_eq!(fetch_contact_hidden(&pool, bob).await?, Some(false));
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
    // Multi-domain companies lock each (team, domain) on disable; the
    // flag flips but contacts/sources/domains are preserved.
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
    assert_eq!(count_contacts(&pool, company_id).await?, 2);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 2);
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
