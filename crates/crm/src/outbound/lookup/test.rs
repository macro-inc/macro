mod message_store;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgCrmParentReader;
use messages::domain::{
    models::MessageParent,
    ports::{CrmParentFacts, CrmParentReader},
};

const OWNER: &str = "macro|crm-lookup-owner@example.com";

async fn seed_team(pool: &PgPool) -> Uuid {
    let team_id = Uuid::now_v7();
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
    )
    .bind(macro_user_id)
    .bind(OWNER)
    .bind(format!("stripe_{macro_user_id}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(OWNER)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'team', $2)")
        .bind(team_id)
        .bind(OWNER)
        .execute(pool)
        .await
        .unwrap();
    team_id
}

async fn seed_company(
    pool: &PgPool,
    team_id: Uuid,
    custom_name: Option<&str>,
    domains: &[&str],
) -> Uuid {
    let company_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_companies (id, team_id, custom_name, first_interaction, last_interaction)
         VALUES ($1, $2, $3, now(), now())",
    )
    .bind(company_id)
    .bind(team_id)
    .bind(custom_name)
    .execute(pool)
    .await
    .unwrap();
    for (offset, domain) in domains.iter().enumerate() {
        sqlx::query(
            "INSERT INTO crm_domains (company_id, team_id, domain, created_at)
             VALUES ($1, $2, $3, now() + make_interval(secs => $4))",
        )
        .bind(company_id)
        .bind(team_id)
        .bind(*domain)
        .bind(offset as f64)
        .execute(pool)
        .await
        .unwrap();
    }
    company_id
}

async fn seed_contact(pool: &PgPool, company_id: Uuid, email: &str, name: Option<&str>) -> Uuid {
    let contact_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction)
         VALUES ($1, $2, $3, $4, now(), now())",
    )
    .bind(contact_id)
    .bind(company_id)
    .bind(email)
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
    contact_id
}

async fn read(pool: &PgPool, parent: MessageParent) -> Option<CrmParentFacts> {
    PgCrmParentReader::new(pool.clone())
        .read_crm_parent(&parent)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_name_prefers_custom_then_directory_then_primary_domain(pool: PgPool) {
    let team_id = seed_team(&pool).await;
    sqlx::query(
        "INSERT INTO crm_domain_directory (domain, name)
         VALUES ('custom.test', 'Custom Directory'), ('dir.test', 'Dir Directory')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let custom = seed_company(&pool, team_id, Some("Acme Custom"), &["custom.test"]).await;
    let directory = seed_company(&pool, team_id, None, &["DIR.test", "other.test"]).await;
    let bare = seed_company(&pool, team_id, None, &["first.test", "second.test"]).await;

    let custom = read(&pool, MessageParent::CrmCompany(custom))
        .await
        .unwrap();
    assert_eq!(custom.name, "Acme Custom");
    assert_eq!(custom.team_id, team_id);
    let directory = read(&pool, MessageParent::CrmCompany(directory))
        .await
        .unwrap();
    assert_eq!(directory.name, "Dir Directory");
    let bare_parent = read(&pool, MessageParent::CrmCompany(bare)).await.unwrap();
    assert_eq!(bare_parent.name, "first.test");
    assert_eq!(bare_parent.company_id, bare);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contact_resolves_its_company_and_falls_back_to_email(pool: PgPool) {
    let team_id = seed_team(&pool).await;
    let company_id = seed_company(&pool, team_id, None, &["acme.test"]).await;
    let named = seed_contact(&pool, company_id, "ada@acme.test", Some("Ada")).await;
    let unnamed = seed_contact(&pool, company_id, "bob@acme.test", Some("")).await;

    let named = read(&pool, MessageParent::CrmContact(named)).await.unwrap();
    assert_eq!(
        named,
        CrmParentFacts {
            team_id,
            company_id,
            name: "Ada".into(),
        }
    );
    let unnamed = read(&pool, MessageParent::CrmContact(unnamed))
        .await
        .unwrap();
    assert_eq!(unnamed.name, "bob@acme.test");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_records_are_absent(pool: PgPool) {
    let team_id = seed_team(&pool).await;
    let company_id = seed_company(&pool, team_id, None, &["gone.test"]).await;
    let contact_id = seed_contact(&pool, company_id, "gone@gone.test", None).await;
    sqlx::query("DELETE FROM crm_companies WHERE id = $1")
        .bind(company_id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(
        read(&pool, MessageParent::CrmCompany(company_id))
            .await
            .is_none()
    );
    assert!(
        read(&pool, MessageParent::CrmContact(contact_id))
            .await
            .is_none()
    );
    assert!(
        read(&pool, MessageParent::CrmCompany(Uuid::now_v7()))
            .await
            .is_none()
    );
}
