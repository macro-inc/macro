use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

async fn set_contact(
    pool: &PgPool,
    contact_id: Uuid,
    name: &str,
    last_interaction_days_ago: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE crm_contacts
           SET name = $2, last_interaction = now() - make_interval(days => $3)
           WHERE id = $1"#,
    )
    .bind(contact_id)
    .bind(name)
    .bind(last_interaction_days_ago)
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_contacts_matches_email_or_name_most_recent_first(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let ada = insert_contact_with_source(&pool, company_id, "ada@acme.com", link_id).await?;
    let grace = insert_contact_with_source(&pool, company_id, "grace@acme.com", link_id).await?;
    let linus = insert_contact_with_source(&pool, company_id, "linus@acme.com", link_id).await?;
    set_contact(&pool, ada, "Ada Lovelace", 3).await?;
    set_contact(&pool, grace, "Grace Hopper", 1).await?;
    set_contact(&pool, linus, "Linus", 2).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let by_name: Vec<Uuid> = repo
        .search_contacts_for_team(&team_id, "HOPPER", 20, false)
        .await?
        .into_iter()
        .map(|contact| contact.id)
        .collect();
    assert_eq!(by_name, vec![grace]);

    let by_email: Vec<Uuid> = repo
        .search_contacts_for_team(&team_id, "a@acme", 20, false)
        .await?
        .into_iter()
        .map(|contact| contact.id)
        .collect();
    assert_eq!(by_email, vec![ada]);

    let recent: Vec<Uuid> = repo
        .search_contacts_for_team(&team_id, "", 2, false)
        .await?
        .into_iter()
        .map(|contact| contact.id)
        .collect();
    assert_eq!(recent, vec![grace, linus]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_contacts_treats_like_wildcards_literally(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    insert_contact_with_source(&pool, company_id, "ada@acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.search_contacts_for_team(&team_id, "%", 20, false)
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_contacts_is_team_scoped_and_hides_hidden_rows_from_members(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    let owner_a = "macro|a@test.com";
    seed_team(&pool, team_a, owner_a).await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let visible_company = insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let hidden_company = insert_company(&pool, team_a, true, &["globex.com"]).await?;
    let link_id = insert_email_link(&pool, owner_a, "a@macro.test").await?;
    let visible =
        insert_contact_with_source(&pool, visible_company, "ada@acme.com", link_id).await?;
    let hidden_contact =
        insert_contact_with_source(&pool, visible_company, "eve@acme.com", link_id).await?;
    let under_hidden_company =
        insert_contact_with_source(&pool, hidden_company, "hal@globex.com", link_id).await?;
    sqlx::query(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#)
        .bind(hidden_contact)
        .execute(&pool)
        .await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(hidden_company)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let member: Vec<Uuid> = repo
        .search_contacts_for_team(&team_a, "", 20, false)
        .await?
        .into_iter()
        .map(|contact| contact.id)
        .collect();
    assert_eq!(member, vec![visible]);

    let mut admin: Vec<Uuid> = repo
        .search_contacts_for_team(&team_a, "", 20, true)
        .await?
        .into_iter()
        .map(|contact| contact.id)
        .collect();
    admin.sort();
    let mut expected = vec![visible, hidden_contact, under_hidden_company];
    expected.sort();
    assert_eq!(admin, expected);

    assert!(
        repo.search_contacts_for_team(&team_b, "", 20, true)
            .await?
            .is_empty()
    );
    Ok(())
}
