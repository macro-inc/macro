use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use system_properties::{
    PgSystemPropertiesRepository, SystemPropertiesServiceImpl, SystemPropertyKey,
};
use uuid::Uuid;

use super::*;

const MEMBER: &str = "macro|rep@ours.com";
const TEAMMATE: &str = "macro|teammate@acme.com";

async fn seed_team(pool: &PgPool, crm_enabled: bool) -> Uuid {
    let team_id = Uuid::now_v7();
    for user_id in [MEMBER, TEAMMATE] {
        let macro_user_id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        )
        .bind(macro_user_id)
        .bind(user_id)
        .bind(format!("stripe_{macro_user_id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
            .bind(user_id)
            .bind(macro_user_id)
            .execute(pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'team', $2)")
        .bind(team_id)
        .bind(MEMBER)
        .execute(pool)
        .await
        .unwrap();
    // The teammate's address shares the customer's domain, so only the
    // membership check keeps them out of the team's CRM matches.
    for (user_id, role) in [(MEMBER, "owner"), (TEAMMATE, "member")] {
        sqlx::query(
            "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::team_role)",
        )
        .bind(user_id)
        .bind(team_id)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query("INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, $2)")
        .bind(team_id)
        .bind(crm_enabled)
        .execute(pool)
        .await
        .unwrap();
    team_id
}

async fn insert_company(pool: &PgPool, team_id: Uuid, domain: &str, hidden: bool) -> Uuid {
    let company_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_companies (id, team_id, hidden, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(company_id)
    .bind(team_id)
    .bind(hidden)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)")
        .bind(company_id)
        .bind(team_id)
        .bind(domain)
        .execute(pool)
        .await
        .unwrap();
    company_id
}

async fn insert_contact(pool: &PgPool, company_id: Uuid, email: &str) -> Uuid {
    let contact_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(contact_id)
    .bind(company_id)
    .bind(email)
    .execute(pool)
    .await
    .unwrap();
    contact_id
}

fn linker(
    pool: &PgPool,
) -> PgCallCrmLinker<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>> {
    PgCallCrmLinker::new(
        pool.clone(),
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(pool.clone())),
    )
}

fn people(user_ids: &[&str], invitee_emails: &[&str]) -> CallPeople {
    CallPeople {
        user_ids: user_ids
            .iter()
            .map(|id| MacroUserIdStr::parse_from_str(id).unwrap().into_owned())
            .collect(),
        invitee_emails: invitee_emails.iter().map(ToString::to_string).collect(),
    }
}

/// Entity ids referenced by the call record's value for `property`.
async fn linked_ids(
    pool: &PgPool,
    call_record_id: Uuid,
    property: SystemPropertyKey,
) -> Vec<String> {
    let values: Option<serde_json::Value> = sqlx::query_scalar(
        r#"SELECT values FROM entity_properties
           WHERE entity_id = $1 AND entity_type = 'CALL_RECORD' AND property_definition_id = $2"#,
    )
    .bind(call_record_id.to_string())
    .bind(property.uuid())
    .fetch_optional(pool)
    .await
    .unwrap();
    let mut ids: Vec<String> = values
        .and_then(|values| values["value"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .map(|reference| reference["entity_id"].as_str().unwrap().to_string())
        .collect();
    ids.sort();
    ids
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn links_companies_by_domain_and_contacts_by_address(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let acme = insert_company(&pool, team_id, "acme.com", false).await;
    let globex = insert_company(&pool, team_id, "globex.com", false).await;
    let hidden = insert_company(&pool, team_id, "hidden.com", true).await;
    let ada = insert_contact(&pool, acme, "ada@acme.com").await;
    insert_contact(&pool, acme, "absent@acme.com").await;
    let call_record_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_record_id,
            &people(
                &[MEMBER, TEAMMATE, "macro|Ada@Acme.com"],
                &[
                    "new@globex.com",
                    "x@hidden.com",
                    "friend@gmail.com",
                    "not-an-email",
                ],
            ),
        )
        .await
        .unwrap();

    let mut companies = vec![acme.to_string(), globex.to_string()];
    companies.sort();
    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies).await,
        companies
    );
    assert!(!companies.contains(&hidden.to_string()));
    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Contacts).await,
        vec![ada.to_string()]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn skips_teams_without_the_crm_enabled(pool: PgPool) {
    let team_id = seed_team(&pool, false).await;
    let acme = insert_company(&pool, team_id, "acme.com", false).await;
    insert_contact(&pool, acme, "ada@acme.com").await;
    let call_record_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(call_record_id, &people(&[MEMBER], &["ada@acme.com"]))
        .await
        .unwrap();

    assert!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies)
            .await
            .is_empty()
    );
    assert!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Contacts)
            .await
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn never_matches_the_teams_own_members(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    insert_company(&pool, team_id, "acme.com", false).await;
    let call_record_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(call_record_id, &people(&[MEMBER, TEAMMATE], &[]))
        .await
        .unwrap();

    assert!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies)
            .await
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn keeps_associations_a_user_already_edited(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    insert_company(&pool, team_id, "acme.com", false).await;
    let call_record_id = Uuid::now_v7();
    let chosen = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           VALUES ($1, $2, 'CALL_RECORD', $3, $4)"#,
    )
    .bind(Uuid::now_v7())
    .bind(call_record_id.to_string())
    .bind(SystemPropertyKey::Companies.uuid())
    .bind(serde_json::json!({
        "type": "EntityReference",
        "value": [{ "entity_type": "COMPANY", "entity_id": chosen.to_string() }]
    }))
    .execute(&pool)
    .await
    .unwrap();

    linker(&pool)
        .link_call_record(call_record_id, &people(&[MEMBER], &["ada@acme.com"]))
        .await
        .unwrap();

    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies).await,
        vec![chosen.to_string()]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matches_accounts_and_contacts_regardless_of_case(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let acme = insert_company(&pool, team_id, "acme.com", false).await;
    let grace = insert_contact(&pool, acme, "Grace@Acme.com").await;
    let call_record_id = Uuid::now_v7();

    // The member's id differs only by case from `team_user`.
    linker(&pool)
        .link_call_record(
            call_record_id,
            &people(&["macro|Rep@Ours.com"], &["grace@acme.com"]),
        )
        .await
        .unwrap();

    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies).await,
        vec![acme.to_string()]
    );
    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Contacts).await,
        vec![grace.to_string()]
    );
}
