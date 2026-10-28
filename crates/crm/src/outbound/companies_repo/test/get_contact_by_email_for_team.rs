use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::CrmError;
use crate::outbound::companies_repo::*;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_lookup_requires_an_unambiguous_visible_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let first_company = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let second_company = insert_company(&pool, team_id, true, &["other.com"]).await?;
    let repo = CompaniesRepositoryImpl::new(pool);
    let first = repo
        .create_contact_for_company(
            &team_id,
            &first_company,
            "jane@gmail.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await?;
    let second = repo
        .create_contact_for_company(
            &team_id,
            &second_company,
            "jane@gmail.com",
            "Jane",
            Utc::now(),
            false,
        )
        .await?;

    assert!(matches!(
        repo.get_contact_by_email_for_team(&team_id, "Jane@Gmail.com", false).await,
        Err(CrmError::InvalidRequest(message)) if message.contains("Select a contact by ID")
    ));

    repo.set_contact_hidden(&team_id, &second.id, true).await?;
    assert_eq!(
        repo.get_contact_by_email_for_team(&team_id, "jane@gmail.com", false)
            .await?
            .unwrap()
            .id,
        first.id
    );
    assert!(matches!(
        repo.get_contact_by_email_for_team(&team_id, "jane@gmail.com", true)
            .await,
        Err(CrmError::InvalidRequest(_))
    ));
    repo.set_contact_hidden(&team_id, &second.id, false).await?;
    repo.set_company_hidden(&team_id, &second_company, true)
        .await?;
    assert_eq!(
        repo.get_contact_by_email_for_team(&team_id, "jane@gmail.com", false)
            .await?
            .unwrap()
            .id,
        first.id
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_by_email_returns_team_contact_case_insensitively(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let contact_id =
        insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let contact = repo
        .get_contact_by_email_for_team(&team_id, "Alice@Acme.com", false)
        .await?
        .expect("contact should be returned");

    assert_eq!(contact.id, contact_id);
    assert_eq!(contact.company_id, company_id);
    assert_eq!(contact.email, "alice@acme.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_by_email_does_not_leak_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    let owner_a = "macro|a@test.com";
    seed_team(&pool, team_a, owner_a).await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let link_a = insert_email_link(&pool, owner_a, "a@macro.test").await?;
    insert_contact_with_source(&pool, company_a, "alice@acme.com", link_a).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_contact_by_email_for_team(&team_b, "alice@acme.com", false)
        .await?;

    assert!(result.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_by_email_applies_hidden_contact_visibility(
    pool: PgPool,
) -> anyhow::Result<()> {
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
    assert!(
        repo.get_contact_by_email_for_team(&team_id, "alice@acme.com", false)
            .await?
            .is_none()
    );

    let admin = repo
        .get_contact_by_email_for_team(&team_id, "alice@acme.com", true)
        .await?
        .expect("admin should see hidden contact");
    assert_eq!(admin.id, contact_id);
    assert!(admin.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_contact_by_email_applies_hidden_company_visibility(
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
        repo.get_contact_by_email_for_team(&team_id, "alice@acme.com", false)
            .await?
            .is_none()
    );

    let admin = repo
        .get_contact_by_email_for_team(&team_id, "alice@acme.com", true)
        .await?
        .expect("admin should reach contact under hidden company");
    assert_eq!(admin.id, contact_id);
    Ok(())
}
