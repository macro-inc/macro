use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const TEAM_ALPHA: Uuid = Uuid::from_u128(0x000000000000000000000000000ea001);

async fn insert_company(pool: &PgPool, hidden: bool) -> anyhow::Result<Uuid> {
    let company_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO crm_companies (id, team_id, hidden, first_interaction, last_interaction)
        VALUES ($1, $2, $3, now(), now())",
        company_id,
        TEAM_ALPHA,
        hidden,
    )
    .execute(pool)
    .await?;
    Ok(company_id)
}

async fn insert_contact(pool: &PgPool, company_id: Uuid, hidden: bool) -> anyhow::Result<Uuid> {
    let contact_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO crm_contacts (id, company_id, email, hidden, first_interaction, last_interaction)
        VALUES ($1, $2, $3, $4, now(), now())",
        contact_id,
        company_id,
        format!("{contact_id}@example.com"),
        hidden,
    )
    .execute(pool)
    .await?;
    Ok(contact_id)
}

async fn users(pool: &PgPool, id: Uuid, entity_type: EntityType) -> Vec<String> {
    let mut users: Vec<String> = get_crm_entity_users(pool, &id, entity_type)
        .await
        .unwrap()
        .into_iter()
        .map(|user| user.as_ref().to_owned())
        .collect();
    users.sort();
    users
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn visible_records_reach_the_whole_team(pool: PgPool) -> anyhow::Result<()> {
    let company = insert_company(&pool, false).await?;
    let contact = insert_contact(&pool, company, false).await?;
    let team = vec![
        "macro|admin@team.com".to_owned(),
        "macro|member@team.com".to_owned(),
        "macro|owner@team.com".to_owned(),
    ];
    assert_eq!(users(&pool, company, EntityType::CrmCompany).await, team);
    assert_eq!(users(&pool, contact, EntityType::CrmContact).await, team);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn hidden_records_exclude_plain_members(pool: PgPool) -> anyhow::Result<()> {
    let hidden_company = insert_company(&pool, true).await?;
    let contact_of_hidden = insert_contact(&pool, hidden_company, false).await?;
    let visible_company = insert_company(&pool, false).await?;
    let hidden_contact = insert_contact(&pool, visible_company, true).await?;
    let admins = vec![
        "macro|admin@team.com".to_owned(),
        "macro|owner@team.com".to_owned(),
    ];
    assert_eq!(
        users(&pool, hidden_company, EntityType::CrmCompany).await,
        admins
    );
    assert_eq!(
        users(&pool, contact_of_hidden, EntityType::CrmContact).await,
        admins
    );
    assert_eq!(
        users(&pool, hidden_contact, EntityType::CrmContact).await,
        admins
    );
    assert!(
        users(&pool, Uuid::new_v4(), EntityType::CrmCompany)
            .await
            .is_empty()
    );
    Ok(())
}
