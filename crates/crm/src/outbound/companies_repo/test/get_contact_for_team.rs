use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_returns_owned_visible_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_contacts SET name = 'Alice Adams' WHERE id = $1"#)
        .bind(contact_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let contact = repo
        .get_contact_for_team(&team_id, &contact_id, false)
        .await?
        .expect("contact should be returned");

    assert_eq!(contact.id, contact_id);
    assert_eq!(contact.company_id, company_id);
    assert_eq!(contact.email, "alice@acme.com");
    assert_eq!(contact.name.as_deref(), Some("Alice Adams"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_returns_none_for_unknown_id(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_contact_for_team(&team_id, &Uuid::now_v7(), false)
        .await?;
    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_does_not_leak_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let link_a = insert_email_link(&pool, "macro|a@test.com", "a@macro.test").await?;
    let contact_a = insert_contact_with_source(&pool, company_a, "alice@acme.com", link_a).await?;

    // Team B fetching team A's contact must get None, not the row.
    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_contact_for_team(&team_b, &contact_a, false)
        .await?;
    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_returns_none_for_hidden_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#)
        .bind(contact_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_contact_for_team(&team_id, &contact_id, false)
        .await?;
    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_returns_none_when_parent_company_is_hidden(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Defensive: a non-hidden contact whose parent company is hidden
    // must not be reachable. In practice `set_company_hidden` tears
    // down contacts on hide, but the query enforces the invariant.
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    // Force company hidden directly (bypassing the service cascade)
    // to simulate a stale row from a prior buggy code path.
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_contact_for_team(&team_id, &contact_id, false)
        .await?;
    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_admin_sees_hidden_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#)
        .bind(contact_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);

    // Member: hidden contact → None (404).
    assert!(
        repo.get_contact_for_team(&team_id, &contact_id, false)
            .await?
            .is_none()
    );

    // Admin: contact is reachable; response carries hidden=true.
    let admin = repo
        .get_contact_for_team(&team_id, &contact_id, true)
        .await?
        .expect("admin should see hidden contact");
    assert_eq!(admin.id, contact_id);
    assert!(admin.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_admin_reaches_contact_under_hidden_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_contact_for_team(&team_id, &contact_id, false)
            .await?
            .is_none()
    );
    let admin = repo
        .get_contact_for_team(&team_id, &contact_id, true)
        .await?
        .expect("admin should reach a contact under a hidden company");
    assert_eq!(admin.id, contact_id);
    Ok(())
}
