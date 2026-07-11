use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

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
        .list_contacts_for_company(&team_id, &company_id, false)
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
        .list_contacts_for_company(&team_id, &company_id, false)
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
        .list_contacts_for_company(&team_id, &company_id, false)
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
        .list_contacts_for_company(&team_id, &Uuid::now_v7(), false)
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
    let result = repo
        .list_contacts_for_company(&team_b, &company_a, false)
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_admin_sees_hidden_contacts(pool: PgPool) -> anyhow::Result<()> {
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

    // Member: only the visible contact.
    let member = repo
        .list_contacts_for_company(&team_id, &company_id, false)
        .await?;
    let member_ids: Vec<Uuid> = member.iter().map(|c| c.id).collect();
    assert_eq!(member_ids, vec![visible]);

    // Admin: both contacts; the response carries the hidden flag so the
    // admin UI can render the right toggle state.
    let admin = repo
        .list_contacts_for_company(&team_id, &company_id, true)
        .await?;
    let admin_ids: Vec<Uuid> = admin.iter().map(|c| c.id).collect();
    assert_eq!(admin_ids.len(), 2);
    assert!(admin_ids.contains(&visible));
    assert!(admin_ids.contains(&hidden));
    let hidden_contact = admin.iter().find(|c| c.id == hidden).expect("hidden");
    assert!(hidden_contact.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_contacts_admin_reaches_hidden_company(pool: PgPool) -> anyhow::Result<()> {
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

    // Member: hidden parent → 404 (CompanyNotFoundForTeam).
    let member = repo
        .list_contacts_for_company(&team_id, &company_id, false)
        .await;
    assert!(matches!(
        member,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));

    // Admin: the hidden company is reachable.
    let admin = repo
        .list_contacts_for_company(&team_id, &company_id, true)
        .await?;
    assert_eq!(admin.len(), 1);
    Ok(())
}
