use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_returns_owned_visible_company_with_contacts(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let alice = insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    let bob = insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let record = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?
        .expect("company should be returned");

    assert_eq!(record.company.id, company_id);
    assert_eq!(record.company.team_id, team_id);
    assert!(record.company.email_sync);
    assert!(!record.company.hidden);
    assert_eq!(record.company.domains.len(), 1);
    assert_eq!(record.company.domains[0].domain, "acme.com");
    // No directory row → display name/description fall through to None.
    assert_eq!(record.name, None);
    assert_eq!(record.description, None);
    // Contacts arrive bundled in.
    let contact_ids: Vec<Uuid> = record.contacts.iter().map(|c| c.id).collect();
    assert_eq!(contact_ids.len(), 2);
    assert!(contact_ids.contains(&alice));
    assert!(contact_ids.contains(&bob));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_returns_company_with_no_contacts(pool: PgPool) -> anyhow::Result<()> {
    // A company with zero contacts should still resolve — `contacts` is
    // empty, not the whole record collapsing to None.
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let record = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?
        .expect("company should be returned");

    assert_eq!(record.company.id, company_id);
    assert!(record.contacts.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_returns_none_for_unknown_id(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_company_for_team(&team_id, &Uuid::now_v7(), false)
        .await?;
    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_does_not_leak_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    // Team B fetching team A's company must get None even as admin.
    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_company_for_team(&team_b, &company_a, false)
            .await?
            .is_none()
    );
    assert!(
        repo.get_company_for_team(&team_b, &company_a, true)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_returns_none_for_hidden_company_member(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?;
    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_admin_sees_hidden_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);

    // Member: hidden → None.
    assert!(
        repo.get_company_for_team(&team_id, &company_id, false)
            .await?
            .is_none()
    );

    // Admin: reachable; response carries hidden = true so the UI can
    // render the right toggle state.
    let admin = repo
        .get_company_for_team(&team_id, &company_id, true)
        .await?
        .expect("admin should see hidden company");
    assert!(admin.company.hidden);
    assert_eq!(admin.contacts.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_filters_hidden_contacts_for_member(pool: PgPool) -> anyhow::Result<()> {
    // Company itself is visible; one of its contacts is hidden.
    // Member: contacts list excludes the hidden one. Admin: both.
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

    let member = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?
        .expect("company visible to member");
    let member_contacts: Vec<Uuid> = member.contacts.iter().map(|c| c.id).collect();
    assert_eq!(member_contacts, vec![visible]);

    let admin = repo
        .get_company_for_team(&team_id, &company_id, true)
        .await?
        .expect("company visible to admin");
    let admin_contacts: Vec<Uuid> = admin.contacts.iter().map(|c| c.id).collect();
    assert_eq!(admin_contacts.len(), 2);
    assert!(admin_contacts.contains(&visible));
    assert!(admin_contacts.contains(&hidden));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_hydrates_name_and_description_from_primary_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Two domains; directory row only on the primary (earliest-created).
    // The handler returns metadata from the primary, not the secondary.
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com", "acmecorp.com"]).await?;
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
    let record = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?
        .expect("company should be returned");

    assert_eq!(record.name.as_deref(), Some("Acme Inc."));
    assert_eq!(
        record.description.as_deref(),
        Some("Maker of rocket-powered roller skates.")
    );
    // Domain order is by created_at ASC; primary first.
    assert_eq!(record.company.domains.len(), 2);
    assert_eq!(record.company.domains[0].domain, "acme.com");
    assert_eq!(record.company.domains[1].domain, "acmecorp.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_company_returns_none_for_negative_cache_directory_row(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Negative-cache directory row (NULL name/description) must surface
    // as None on the response, not Some("").
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description)
           VALUES ($1, NULL, NULL)"#,
    )
    .bind("acme.com")
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let record = repo
        .get_company_for_team(&team_id, &company_id, false)
        .await?
        .expect("company should be returned");
    assert_eq!(record.name, None);
    assert_eq!(record.description, None);
    Ok(())
}
