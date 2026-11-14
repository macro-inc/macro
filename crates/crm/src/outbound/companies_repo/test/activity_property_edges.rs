use std::collections::BTreeSet;

use crate::domain::{
    association::CrmActivityEdge, companies_repo::CompaniesRepository,
    contact_listing::CrmContactListScope,
};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::EntityType;
use serde_json::{Value, json};
use sqlx::PgPool;
use system_properties::SystemPropertyKey;
use uuid::Uuid;

const STRANGER: &str = "macro|stranger@example.com";
/// A visible company of team 11 whose id has hex letters, so case matters.
const LETTERED: u128 = 0xabc;
const ALL_TYPES: [EntityType; 13] = [
    EntityType::CalendarEvent,
    EntityType::CallRecord,
    EntityType::Channel,
    EntityType::Chat,
    EntityType::Company,
    EntityType::DatabaseRow,
    EntityType::Contact,
    EntityType::Document,
    EntityType::Initiative,
    EntityType::Project,
    EntityType::Task,
    EntityType::Thread,
    EntityType::User,
];

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

/// The fixture's viewer: admin of team 11, member of teams 12 and 13.
async fn viewer(pool: &PgPool) -> String {
    sqlx::query_scalar!(
        "SELECT user_id FROM team_user WHERE team_id = $1 AND team_role = 'admin'",
        id(11)
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn reference(entity_id: impl Into<String>) -> Value {
    json!({ "entity_id": entity_id.into(), "entity_type": "COMPANY" })
}

async fn set_property(
    pool: &PgPool,
    entity_type: EntityType,
    entity_id: &str,
    property: SystemPropertyKey,
    value: Value,
) {
    sqlx::query!(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           VALUES ($1, $2, $3, $4, $5)"#,
        Uuid::now_v7(),
        entity_id,
        entity_type as EntityType,
        property.uuid(),
        json!({ "type": "EntityReference", "value": value }),
    )
    .execute(pool)
    .await
    .unwrap();
}

/// What the activity association found before: the scope's record ids, then
/// every item whose Companies or Contacts property contains one of them.
async fn old_edges(
    repo: &CompaniesRepositoryImpl,
    pool: &PgPool,
    scope: CrmContactListScope<'_>,
    entity_types: &[EntityType],
) -> BTreeSet<(String, String)> {
    let activity = repo.resolve_activity(scope).await.unwrap();
    let company_ids: Vec<String> = activity.company_ids.iter().map(Uuid::to_string).collect();
    let contact_ids: Vec<String> = activity.contact_ids.iter().map(Uuid::to_string).collect();
    sqlx::query!(
        r#"
        SELECT ep.entity_type::text AS "entity_type!", ep.entity_id AS "entity_id!"
        FROM UNNEST($1::text[]) AS company(id)
        JOIN entity_properties ep
            ON ep.property_definition_id = '00000001-0000-0000-0000-00000000000c'
           AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', company.id))
        WHERE ep.entity_type = ANY($3::property_entity_type[])
        UNION
        SELECT ep.entity_type::text, ep.entity_id
        FROM UNNEST($2::text[]) AS contact(id)
        JOIN entity_properties ep
            ON ep.property_definition_id = '00000001-0000-0000-0000-000000000013'
           AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', contact.id))
        WHERE ep.entity_type = ANY($3::property_entity_type[])
        "#,
        &company_ids,
        &contact_ids,
        entity_types as &[EntityType],
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.entity_type, row.entity_id))
    .collect()
}

async fn new_edges(
    repo: &CompaniesRepositoryImpl,
    scope: CrmContactListScope<'_>,
    entity_types: &[EntityType],
) -> Vec<(String, String)> {
    repo.activity_property_edges(scope, entity_types)
        .await
        .unwrap()
        .into_iter()
        .map(|edge| (type_label(edge.entity_type), edge.entity_id))
        .collect()
}

/// The `property_entity_type` label, as `entity_type::text` prints it.
fn type_label(entity_type: EntityType) -> String {
    serde_json::to_value(entity_type)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

/// Records beyond the fixture: a visible company whose id has hex letters,
/// company-less contacts that are visible, hidden, or in a team the viewer is
/// not in, and a contact whose company belongs to another team.
async fn add_records(pool: &PgPool) {
    sqlx::query!(
        r#"INSERT INTO crm_companies (id, team_id, custom_name, first_interaction, last_interaction)
           VALUES ($1, $2, 'Lettered', now(), now())"#,
        id(LETTERED),
        id(11),
    )
    .execute(pool)
    .await
    .unwrap();
    for (contact, team, hidden) in [(2001, 11, false), (2002, 11, true), (2003, 14, false)] {
        sqlx::query!(
            r#"INSERT INTO crm_contacts (id, team_id, email, hidden, first_interaction, last_interaction)
               VALUES ($1, $2, $3, $4, now(), now())"#,
            id(contact),
            id(team),
            format!("c{contact}@personal.example.com"),
            hidden,
        )
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        r#"INSERT INTO crm_contacts (id, team_id, company_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, $3, 'cross@example.com', now(), now())"#,
        id(2004),
        id(11),
        id(102),
    )
    .execute(pool)
    .await
    .unwrap();
}

/// One item per case, named for what its property holds.
async fn add_items(pool: &PgPool) {
    let companies = SystemPropertyKey::Companies;
    let contacts = SystemPropertyKey::Contacts;
    let canonical = |value: u128| reference(id(value).to_string());
    // Visible companies of team 11, 12 and 13 (a team with CRM off).
    set_property(
        pool,
        EntityType::Task,
        "task-101",
        companies,
        json!([canonical(101)]),
    )
    .await;
    set_property(
        pool,
        EntityType::Document,
        "doc-102",
        companies,
        json!([canonical(102)]),
    )
    .await;
    set_property(
        pool,
        EntityType::CallRecord,
        "call-103",
        companies,
        json!([canonical(103)]),
    )
    .await;
    // Team 14 is not the viewer's; 105 is hidden.
    set_property(
        pool,
        EntityType::Task,
        "task-104",
        companies,
        json!([canonical(104)]),
    )
    .await;
    set_property(
        pool,
        EntityType::Task,
        "task-105",
        companies,
        json!([canonical(105)]),
    )
    .await;
    // Several references, one in scope: one edge.
    set_property(
        pool,
        EntityType::Chat,
        "chat-many",
        companies,
        json!([
            canonical(104),
            canonical(105),
            canonical(101),
            canonical(101)
        ]),
    )
    .await;
    // Contacts: under a visible company (1004), hidden (1008), under a hidden
    // company (1006), in another team (1003), company-less visible (2001),
    // company-less hidden (2002), company-less elsewhere (2003), under a
    // company of another team (2004).
    for (entity_id, contact) in [
        ("cal-1004", 1004),
        ("cal-1008", 1008),
        ("cal-1006", 1006),
        ("cal-1003", 1003),
        ("cal-2001", 2001),
        ("cal-2002", 2002),
        ("cal-2003", 2003),
        ("cal-2004", 2004),
    ] {
        set_property(
            pool,
            EntityType::CalendarEvent,
            entity_id,
            contacts,
            json!([canonical(contact)]),
        )
        .await;
    }
    // The same item names both a company and a contact: one edge.
    set_property(
        pool,
        EntityType::Project,
        "project-both",
        companies,
        json!([canonical(101)]),
    )
    .await;
    set_property(
        pool,
        EntityType::Project,
        "project-both",
        contacts,
        json!([canonical(1004)]),
    )
    .await;
    // A contact id in the Companies property, and a company id in Contacts.
    set_property(
        pool,
        EntityType::Channel,
        "channel-swapped",
        companies,
        json!([canonical(1004)]),
    )
    .await;
    set_property(
        pool,
        EntityType::Channel,
        "channel-swapped2",
        contacts,
        json!([canonical(101)]),
    )
    .await;
    // Text the old containment test never matched: uppercase, braces, no
    // hyphens, padding, not an id, a number, no id, a bare string, a nested
    // array. Postgres casts several of these to the id; the old test did not.
    let lettered = id(LETTERED).to_string();
    for (entity_id, value) in [
        ("doc-lettered", json!([reference(lettered.clone())])),
        ("doc-upper", json!([reference(lettered.to_uppercase())])),
        ("doc-braced", json!([reference(format!("{{{lettered}}}"))])),
        (
            "doc-bare-hex",
            json!([reference(lettered.replace('-', ""))]),
        ),
        ("doc-padded", json!([reference(format!(" {lettered}"))])),
        ("doc-not-uuid", json!([reference("not-a-uuid")])),
        ("doc-empty", json!([reference("")])),
        ("doc-number", json!([{ "entity_id": 101 }])),
        ("doc-no-id", json!([{ "entity_type": "COMPANY" }])),
        ("doc-string", json!([lettered.clone()])),
        ("doc-nested", json!([[reference(lettered.clone())]])),
        ("doc-null", json!([null])),
        ("doc-none", json!([])),
    ] {
        set_property(pool, EntityType::Document, entity_id, companies, value).await;
    }
    // Item kinds a view never asks for still match when asked.
    set_property(
        pool,
        EntityType::Company,
        "company-item",
        companies,
        json!([canonical(101)]),
    )
    .await;
    set_property(
        pool,
        EntityType::Contact,
        "contact-item",
        contacts,
        json!([canonical(1004)]),
    )
    .await;
    set_property(
        pool,
        EntityType::Thread,
        "thread-item",
        companies,
        json!([canonical(101)]),
    )
    .await;
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn edges_match_the_scope_ids_and_containment(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let viewer = viewer(&pool).await;
    let viewer = viewer.as_str();
    add_records(&pool).await;
    add_items(&pool).await;

    let views: [&[EntityType]; 5] = [
        &ALL_TYPES,
        &[EntityType::Task, EntityType::Document],
        &[EntityType::Task],
        &[EntityType::CalendarEvent, EntityType::Channel],
        &[EntityType::Thread, EntityType::User],
    ];
    let scopes = || {
        [
            CrmContactListScope::Viewer(viewer),
            CrmContactListScope::Viewer(STRANGER),
            CrmContactListScope::Team {
                team_id: id(11),
                include_hidden: true,
            },
            CrmContactListScope::Team {
                team_id: id(12),
                include_hidden: false,
            },
            CrmContactListScope::Team {
                team_id: id(14),
                include_hidden: true,
            },
        ]
    };
    for types in views {
        for case in 0..scopes().len() {
            let scope = || scopes().into_iter().nth(case).unwrap();
            let label = format!("{:?} {types:?}", scope());
            let new = new_edges(&repo, scope(), types).await;
            let unique: BTreeSet<_> = new.iter().cloned().collect();
            assert_eq!(unique.len(), new.len(), "{label}: duplicate edges");
            assert_eq!(
                unique,
                old_edges(&repo, &pool, scope(), types).await,
                "{label}"
            );
        }
    }

    // The comparison is not vacuous: the viewer's whole scope, by name.
    let viewer_items: BTreeSet<String> =
        new_edges(&repo, CrmContactListScope::Viewer(viewer), &ALL_TYPES)
            .await
            .into_iter()
            .map(|(_, entity_id)| entity_id)
            .collect();
    assert_eq!(
        viewer_items,
        [
            "task-101",
            "doc-102",
            "doc-lettered",
            "call-103",
            "chat-many",
            "cal-1004",
            "cal-2001",
            "project-both",
            "company-item",
            "contact-item",
            "thread-item",
        ]
        .map(String::from)
        .into_iter()
        .collect()
    );
    assert_eq!(
        repo.activity_property_edges(
            CrmContactListScope::Team {
                team_id: id(14),
                include_hidden: true,
            },
            &[
                EntityType::Task,
                EntityType::CalendarEvent,
                EntityType::Chat
            ],
        )
        .await
        .unwrap()
        .into_iter()
        .map(|edge| edge.entity_id)
        .collect::<BTreeSet<_>>(),
        ["task-104", "chat-many", "cal-1003", "cal-2003"]
            .map(String::from)
            .into_iter()
            .collect()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn no_item_kinds_run_no_query(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let viewer = viewer(&pool).await;
    add_items(&pool).await;
    assert_eq!(
        repo.activity_property_edges(CrmContactListScope::Viewer(&viewer), &[])
            .await
            .unwrap(),
        Vec::<CrmActivityEdge>::new()
    );
}

#[test]
fn literal_property_ids_are_the_system_properties() {
    let sql = include_str!("../activity_property_edges.sql");
    assert!(sql.contains(&SystemPropertyKey::COMPANIES_UUID.to_string()));
    assert!(sql.contains(&SystemPropertyKey::CONTACTS_UUID.to_string()));
}
