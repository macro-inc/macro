use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use system_properties::SystemPropertyKey;

const COMPANY: Uuid = Uuid::from_u128(0xc0);
const CONTACT: Uuid = Uuid::from_u128(0xc1);
const OTHER: Uuid = Uuid::from_u128(0xc2);

async fn link(pool: &PgPool, entity_id: &str, entity_type: &str, definition: Uuid, ids: &[Uuid]) {
    let refs: Vec<serde_json::Value> = ids
        .iter()
        .map(|id| serde_json::json!({ "entity_id": id.to_string(), "entity_type": "COMPANY" }))
        .collect();
    sqlx::query(
        r#"INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
           VALUES ($1, $2, $3::property_entity_type, $4, $5)"#,
    )
    .bind(Uuid::now_v7())
    .bind(entity_id)
    .bind(entity_type)
    .bind(definition)
    .bind(serde_json::json!({ "type": "EntityReference", "value": refs }))
    .execute(pool)
    .await
    .unwrap();
}

#[test]
fn literal_property_ids_are_the_system_properties() {
    let sql = include_str!("../crm_association.rs");
    assert!(sql.contains(&SystemPropertyKey::COMPANIES_UUID.to_string()));
    assert!(sql.contains(&SystemPropertyKey::CONTACTS_UUID.to_string()));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matches_companies_and_contacts_once(pool: PgPool) {
    let companies = SystemPropertyKey::COMPANIES_UUID;
    let contacts = SystemPropertyKey::CONTACTS_UUID;
    link(&pool, "task-company", "TASK", companies, &[OTHER, COMPANY]).await;
    link(&pool, "call-contact", "CALL_RECORD", contacts, &[CONTACT]).await;
    // Both properties on one entity still produce one edge.
    link(&pool, "doc-both", "DOCUMENT", companies, &[COMPANY]).await;
    link(&pool, "doc-both", "DOCUMENT", contacts, &[CONTACT]).await;
    // A contact id in the Companies property, or another record, never matches.
    link(
        &pool,
        "doc-wrong-property",
        "DOCUMENT",
        companies,
        &[CONTACT],
    )
    .await;
    link(&pool, "doc-other", "DOCUMENT", contacts, &[OTHER]).await;

    let mut edges = property_edges(&pool, &[COMPANY], &[CONTACT]).await.unwrap();
    edges.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    assert_eq!(
        edges,
        vec![
            CrmPropertyEdge {
                entity_type: EntityType::CallRecord,
                entity_id: "call-contact".into()
            },
            CrmPropertyEdge {
                entity_type: EntityType::Document,
                entity_id: "doc-both".into()
            },
            CrmPropertyEdge {
                entity_type: EntityType::Task,
                entity_id: "task-company".into()
            },
        ]
    );
    assert!(property_edges(&pool, &[], &[]).await.unwrap().is_empty());
    assert_eq!(
        property_edges(&pool, &[], &[CONTACT]).await.unwrap().len(),
        2
    );
}
