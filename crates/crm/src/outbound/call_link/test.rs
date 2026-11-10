use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use system_properties::{
    PgSystemPropertiesRepository, SystemPropertiesServiceImpl, SystemPropertyKey,
};
use uuid::Uuid;

use super::*;
use call::domain::models::CallGuest;

const MEMBER: &str = "macro|rep@ours.example.com";
const TEAMMATE: &str = "macro|teammate@acme.example.com";

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

/// Another CRM-enabled team, owned by a new user `owner`.
async fn other_team(pool: &PgPool, owner: &str) -> Uuid {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
    )
    .bind(macro_user_id)
    .bind(owner)
    .bind(format!("stripe_{macro_user_id}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(owner)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .unwrap();
    let team_id = Uuid::now_v7();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'other team', $2)")
        .bind(team_id)
        .bind(owner)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'owner'::team_role)",
    )
    .bind(owner)
    .bind(team_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)")
        .bind(team_id)
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
        guests: invitee_emails
            .iter()
            .map(|email| CallGuest {
                email: Some(email.to_string()),
                phone: None,
            })
            .collect(),
    }
}

/// An imported call's people: the member, then `(email, phone)` guests.
fn imported(guests: &[(Option<&str>, Option<&str>)]) -> CallPeople {
    CallPeople {
        user_ids: vec![MacroUserIdStr::parse_from_str(MEMBER).unwrap().into_owned()],
        guests: guests
            .iter()
            .map(|(email, phone)| CallGuest {
                email: email.map(ToString::to_string),
                phone: phone.map(ToString::to_string),
            })
            .collect(),
    }
}

async fn insert_phone(pool: &PgPool, contact_id: Uuid, phone: &str) {
    sqlx::query(
        "INSERT INTO crm_contact_phones (contact_id, phone, source) VALUES ($1, $2, 'manual')",
    )
    .bind(contact_id)
    .bind(phone)
    .execute(pool)
    .await
    .unwrap();
}

async fn phones(pool: &PgPool, contact_id: Uuid) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT phone, source FROM crm_contact_phones WHERE contact_id = $1 ORDER BY phone",
    )
    .bind(contact_id)
    .fetch_all(pool)
    .await
    .unwrap()
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
    let acme = insert_company(&pool, team_id, "acme.example.com", false).await;
    let globex = insert_company(&pool, team_id, "globex.com", false).await;
    let hidden = insert_company(&pool, team_id, "hidden.com", true).await;
    let ada = insert_contact(&pool, acme, "ada@acme.example.com").await;
    insert_contact(&pool, acme, "absent@acme.example.com").await;
    let call_record_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_record_id,
            &people(
                &[MEMBER, TEAMMATE, "macro|Ada@Acme.example.com"],
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
async fn links_records_without_email_contribution_consent(pool: PgPool) {
    let team_id = seed_team(&pool, false).await;
    let acme = insert_company(&pool, team_id, "acme.example.com", false).await;
    let ada = insert_contact(&pool, acme, "ada@acme.example.com").await;
    let call_record_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_record_id,
            &people(&[MEMBER], &["ada@acme.example.com"]),
        )
        .await
        .unwrap();

    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies).await,
        vec![acme.to_string()]
    );
    assert_eq!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Contacts).await,
        vec![ada.to_string()]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn never_matches_the_teams_own_members(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    insert_company(&pool, team_id, "acme.example.com", false).await;
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
    insert_company(&pool, team_id, "acme.example.com", false).await;
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
        .link_call_record(
            call_record_id,
            &people(&[MEMBER], &["ada@acme.example.com"]),
        )
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
    let acme = insert_company(&pool, team_id, "acme.example.com", false).await;
    let grace = insert_contact(&pool, acme, "Grace@Acme.example.com").await;
    let call_record_id = Uuid::now_v7();

    // The member's id differs only by case from `team_user`.
    linker(&pool)
        .link_call_record(
            call_record_id,
            &people(&["macro|Rep@Ours.example.com"], &["grace@acme.example.com"]),
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_or_hidden_number_links_nothing(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let acme = insert_company(&pool, team_id, "acme.example", false).await;
    let hidden = insert_contact(&pool, acme, "gone@acme.example").await;
    sqlx::query("UPDATE crm_contacts SET hidden = TRUE WHERE id = $1")
        .bind(hidden)
        .execute(&pool)
        .await
        .unwrap();
    insert_phone(&pool, hidden, "+1555011").await;
    let contacts_before: i64 = sqlx::query_scalar("SELECT count(*) FROM crm_contacts")
        .fetch_one(&pool)
        .await
        .unwrap();
    let call_record_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_record_id,
            &imported(&[(None, Some("+1555012")), (None, Some("+1555011"))]),
        )
        .await
        .unwrap();

    assert!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Contacts)
            .await
            .is_empty()
    );
    assert!(
        linked_ids(&pool, call_record_id, SystemPropertyKey::Companies)
            .await
            .is_empty()
    );
    let contacts_after: i64 = sqlx::query_scalar("SELECT count(*) FROM crm_contacts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(contacts_after, contacts_before, "no contact is created");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn numbers_are_remembered_for_contacts_matched_by_email(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let acme = insert_company(&pool, team_id, "acme.example", false).await;
    let ada = insert_contact(&pool, acme, "ada@acme.example").await;
    insert_phone(&pool, ada, "+1555010").await;
    let call_record_id = Uuid::now_v7();

    let call = imported(&[
        (Some("Ada@Acme.example"), Some("+1555013")),
        (Some("new@acme.example"), Some("+1555014")),
    ]);
    linker(&pool)
        .link_call_record(call_record_id, &call)
        .await
        .unwrap();
    linker(&pool)
        .link_call_record(call_record_id, &call)
        .await
        .unwrap();

    assert_eq!(
        phones(&pool, ada).await,
        vec![
            ("+1555010".to_owned(), "manual".to_owned()),
            ("+1555013".to_owned(), "call".to_owned()),
        ]
    );
    let learned: i64 = sqlx::query_scalar("SELECT count(*) FROM crm_contact_phones")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(learned, 2, "a guest with no contact teaches nothing");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn companyless_contacts_match_by_email_learn_phones_and_match_phone_only_calls(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let contact_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO crm_contacts (id, team_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, 'guest@example.com', now(), now())"#,
        contact_id,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let call_id = Uuid::now_v7();
    linker(&pool)
        .link_call_record(
            call_id,
            &imported(&[(Some("guest@example.com"), Some("+1555010"))]),
        )
        .await
        .unwrap();
    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Contacts).await,
        [contact_id.to_string()]
    );
    assert!(
        linked_ids(&pool, call_id, SystemPropertyKey::Companies)
            .await
            .is_empty()
    );
    assert_eq!(
        phones(&pool, contact_id).await,
        [("+1555010".to_owned(), "call".to_owned())]
    );

    let phone_only = Uuid::now_v7();
    linker(&pool)
        .link_call_record(phone_only, &imported(&[(None, Some("+1555010"))]))
        .await
        .unwrap();
    assert_eq!(
        linked_ids(&pool, phone_only, SystemPropertyKey::Contacts).await,
        [contact_id.to_string()]
    );
    assert!(
        linked_ids(&pool, phone_only, SystemPropertyKey::Companies)
            .await
            .is_empty()
    );

    sqlx::query!(
        "UPDATE crm_contacts SET hidden = TRUE WHERE id = $1",
        contact_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let hidden = Uuid::now_v7();
    linker(&pool)
        .link_call_record(
            hidden,
            &imported(&[(Some("guest@example.com"), Some("+1555010"))]),
        )
        .await
        .unwrap();
    assert!(
        linked_ids(&pool, hidden, SystemPropertyKey::Contacts)
            .await
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_contact_email_outside_the_company_domain_takes_precedence_over_phone(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let company = insert_company(&pool, team_id, "acme.example", false).await;
    let contact = insert_contact(&pool, company, "guest@example.com").await;
    let other_company = insert_company(&pool, team_id, "other.example", false).await;
    let other_contact = insert_contact(&pool, other_company, "other@other.example").await;
    insert_phone(&pool, other_contact, "+1555010").await;
    let call_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_id,
            &imported(&[(Some("guest@example.com"), Some("+1555010"))]),
        )
        .await
        .unwrap();

    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Contacts).await,
        [contact.to_string()]
    );
    assert_eq!(
        phones(&pool, contact).await,
        [("+1555010".to_owned(), "call".to_owned())]
    );
    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Companies).await,
        [company.to_string()]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_number_links_and_is_learned_only_inside_each_team(pool: PgPool) {
    const OTHER_OWNER: &str = "macro|owner-b@example.com";
    let team_a = seed_team(&pool, true).await;
    let team_b = other_team(&pool, OTHER_OWNER).await;
    // No one on the call is on this team, so its CRM never sees the call.
    let team_c = other_team(&pool, "macro|owner-c@example.com").await;
    let acme = insert_company(&pool, team_a, "acme.example", false).await;
    let ada = insert_contact(&pool, acme, "ada@acme.example").await;
    let beta = insert_company(&pool, team_b, "beta.example", false).await;
    let desk = insert_contact(&pool, beta, "desk@beta.example").await;
    insert_phone(&pool, desk, "+1555010").await;
    let gamma = insert_company(&pool, team_c, "gamma.example", false).await;
    let outside = insert_contact(&pool, gamma, "desk@gamma.example").await;
    insert_phone(&pool, outside, "+1555010").await;
    let call_id = Uuid::now_v7();

    // A call with one account from each of teams A and B.
    let mut call = imported(&[(Some("ada@acme.example"), Some("+1555010"))]);
    call.user_ids.push(
        MacroUserIdStr::parse_from_str(OTHER_OWNER)
            .unwrap()
            .into_owned(),
    );
    linker(&pool)
        .link_call_record(call_id, &call)
        .await
        .unwrap();

    // Team A matches the guest by email, team B by number; team C not at all.
    let sorted = |mut ids: Vec<String>| {
        ids.sort();
        ids
    };
    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Contacts).await,
        sorted(vec![ada.to_string(), desk.to_string()])
    );
    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Companies).await,
        sorted(vec![acme.to_string(), beta.to_string()])
    );
    // Only team A's email match learns the number, and only for its contact.
    assert_eq!(
        phones(&pool, ada).await,
        [("+1555010".to_owned(), "call".to_owned())]
    );
    for contact in [desk, outside] {
        assert_eq!(
            phones(&pool, contact).await,
            [("+1555010".to_owned(), "manual".to_owned())]
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_guest_whose_email_matched_only_a_company_still_matches_by_phone(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let acme = insert_company(&pool, team_id, "acme.example", false).await;
    let desk = insert_contact(&pool, acme, "desk@acme.example").await;
    insert_phone(&pool, desk, "+1555010").await;
    let call_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_id,
            &imported(&[(Some("new@acme.example"), Some("+1555010"))]),
        )
        .await
        .unwrap();

    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Contacts).await,
        [desk.to_string()]
    );
    assert_eq!(
        linked_ids(&pool, call_id, SystemPropertyKey::Companies).await,
        [acme.to_string()]
    );
    assert_eq!(
        phones(&pool, desk).await,
        [("+1555010".to_owned(), "manual".to_owned())],
        "only a contact found by email learns a number"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_contact_under_a_hidden_company_neither_links_nor_learns(pool: PgPool) {
    let team_id = seed_team(&pool, true).await;
    let acme = insert_company(&pool, team_id, "acme.example", true).await;
    let desk = insert_contact(&pool, acme, "desk@acme.example").await;
    insert_phone(&pool, desk, "+1555010").await;
    let call_id = Uuid::now_v7();

    linker(&pool)
        .link_call_record(
            call_id,
            &imported(&[
                (None, Some("+1555010")),
                (Some("desk@acme.example"), Some("+1555011")),
            ]),
        )
        .await
        .unwrap();

    for property in [SystemPropertyKey::Contacts, SystemPropertyKey::Companies] {
        assert!(linked_ids(&pool, call_id, property).await.is_empty());
    }
    assert_eq!(
        phones(&pool, desk).await,
        [("+1555010".to_owned(), "manual".to_owned())]
    );
}
