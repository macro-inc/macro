use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::outbound::companies_repo::test::helpers::seed_team;

async fn insert_company(pool: &PgPool, team_id: Uuid, hidden: bool) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO crm_companies (team_id, email_sync, hidden, first_interaction, last_interaction)
        VALUES ($1, true, $2, now(), now())
        RETURNING id
        "#,
        team_id,
        hidden,
    )
    .fetch_one(pool)
    .await
}

async fn insert_contact(pool: &PgPool, company_id: Uuid, hidden: bool) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO crm_contacts (company_id, email, hidden, first_interaction, last_interaction)
        VALUES ($1, 'ada@acme.test', $2, now(), now())
        RETURNING id
        "#,
        company_id,
        hidden,
    )
    .fetch_one(pool)
    .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lists_are_scoped_to_their_team_and_unique_by_name(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let other = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    seed_team(&pool, other, "macro|other@test.com").await?;
    let store = PgListStore::new(pool.clone());

    let deals = store
        .create_list(&team, "Deals", CrmListParentType::Company)
        .await?;
    store
        .create_list(&other, "Deals", CrmListParentType::Company)
        .await?;
    assert!(matches!(
        store
            .create_list(&team, "Deals", CrmListParentType::Contact)
            .await,
        Err(CrmError::InvalidRequest(_))
    ));

    let names: Vec<String> = store
        .list_lists(&team)
        .await?
        .into_iter()
        .map(|list| list.name)
        .collect();
    assert_eq!(names, vec!["Deals"]);
    assert_eq!(store.get_list(&team, &deals.id).await?, Some(deals.clone()));
    assert_eq!(store.get_list(&other, &deals.id).await?, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entries_follow_the_parent_hidden_flag(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    let store = PgListStore::new(pool.clone());
    let list = store
        .create_list(&team, "Deals", CrmListParentType::Company)
        .await?;

    let visible = insert_company(&pool, team, false).await?;
    let hidden = insert_company(&pool, team, true).await?;
    assert!(
        store
            .parent_exists(&team, CrmListParentType::Company, &visible, false)
            .await?
    );
    assert!(
        !store
            .parent_exists(&team, CrmListParentType::Company, &hidden, false)
            .await?
    );
    assert!(
        store
            .parent_exists(&team, CrmListParentType::Company, &hidden, true)
            .await?
    );
    // The parent type must match the id.
    assert!(
        !store
            .parent_exists(&team, CrmListParentType::Contact, &visible, true)
            .await?
    );

    store.create_entry(&list.id, &visible).await?;
    store.create_entry(&list.id, &visible).await?;
    store.create_entry(&list.id, &hidden).await?;
    assert_eq!(store.list_entries(&list.id, false).await?.len(), 2);
    assert_eq!(store.list_entries(&list.id, true).await?.len(), 3);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contact_entries_inherit_the_company_hidden_flag(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    let store = PgListStore::new(pool.clone());
    let list = store
        .create_list(&team, "Candidates", CrmListParentType::Contact)
        .await?;

    let company = insert_company(&pool, team, false).await?;
    let contact = insert_contact(&pool, company, false).await?;
    assert!(
        store
            .parent_exists(&team, CrmListParentType::Contact, &contact, false)
            .await?
    );
    store.create_entry(&list.id, &contact).await?;
    assert_eq!(store.list_entries(&list.id, false).await?.len(), 1);

    sqlx::query!(
        "UPDATE crm_companies SET hidden = true WHERE id = $1",
        company
    )
    .execute(&pool)
    .await?;
    assert!(store.list_entries(&list.id, false).await?.is_empty());
    assert_eq!(store.list_entries(&list.id, true).await?.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_list_removes_its_entries(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    let store = PgListStore::new(pool.clone());
    let list = store
        .create_list(&team, "Deals", CrmListParentType::Company)
        .await?;
    let company = insert_company(&pool, team, false).await?;
    store.create_entry(&list.id, &company).await?;

    sqlx::query!("DELETE FROM crm_lists WHERE id = $1", list.id)
        .execute(&pool)
        .await?;
    let remaining: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM crm_list_entries WHERE list_id = $1"#,
        list.id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining, 0);
    Ok(())
}
