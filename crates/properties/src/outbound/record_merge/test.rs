use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::EntityType;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    ValueScope, lock_entity_values_in, merge_entity_values_in, referencing_rows_in,
    retarget_references_in,
};

const USER: &str = "macro|merge-props@example.com";
const COMPANIES: &str = "00000001-0000-0000-0000-00000000000c";
const REVENUE: &str = "00000001-0000-0000-0000-000000000012";

async fn setup(pool: &PgPool) -> Uuid {
    let macro_user = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'merge-props', 'merge-props@example.com', 'merge-props')",
    )
    .bind(macro_user)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'merge-props@example.com', $2)"#)
        .bind(USER)
        .bind(macro_user)
        .execute(pool)
        .await
        .unwrap();
    let team = Uuid::now_v7();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'test', $2)")
        .bind(team)
        .bind(USER)
        .execute(pool)
        .await
        .unwrap();
    team
}

async fn definition(pool: &PgPool, name: &str, data_type: &str, team: Option<Uuid>, user: Option<&str>) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO property_definitions (id, display_name, data_type, is_multi_select, team_id, user_id)
         VALUES ($1, $2, $3::property_data_type, $4, $5, $6)",
    )
    .bind(id)
    .bind(name)
    .bind(data_type)
    .bind(data_type == "ENTITY")
    .bind(team)
    .bind(user)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn value(pool: &PgPool, entity_id: &str, entity_type: &str, definition: &str, values: Value) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
         VALUES ($1, $2, $3::property_entity_type, $4::uuid, $5)",
    )
    .bind(id)
    .bind(entity_id)
    .bind(entity_type)
    .bind(definition)
    .bind(values)
    .execute(pool)
    .await
    .unwrap();
    id
}

fn refs(entries: &[(&str, &str)]) -> Value {
    json!({
        "type": "EntityReference",
        "value": entries
            .iter()
            .map(|(entity_type, entity_id)| json!({"entity_type": entity_type, "entity_id": entity_id}))
            .collect::<Vec<_>>(),
    })
}

async fn stored(pool: &PgPool, id: Uuid) -> Option<(String, Value)> {
    sqlx::query_as("SELECT entity_id, values FROM entity_properties WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn own_values_move_when_the_survivor_has_none_and_the_rest_are_deleted(pool: PgPool) {
    let team = setup(&pool).await;
    let tier = definition(&pool, "Tier", "STRING", Some(team), None).await;
    let notes = definition(&pool, "My notes", "STRING", None, Some(USER)).await;
    let [survivor, first, second] = [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()].map(|id| id.to_string());

    let kept = value(&pool, &survivor, "COMPANY", &tier.to_string(), json!({"type": "String", "value": "Gold"})).await;
    let dropped = value(&pool, &first, "COMPANY", &tier.to_string(), json!({"type": "String", "value": "Silver"})).await;
    let private = value(&pool, &first, "COMPANY", &notes.to_string(), json!({"type": "String", "value": "mine"})).await;
    let revenue = value(&pool, &second, "COMPANY", REVENUE, json!({"type": "Number", "value": 5})).await;
    let contact = value(&pool, &first, "CONTACT", &tier.to_string(), json!({"type": "String", "value": "Other"})).await;

    let mut tx = pool.begin().await.unwrap();
    let locked = lock_entity_values_in(
        &mut tx,
        EntityType::Company,
        &[survivor.clone(), first.clone(), second.clone()],
    )
    .await
    .unwrap();
    assert_eq!(locked.len(), 4);
    let scope = |id| locked.iter().find(|value| value.id == id).unwrap().scope;
    assert_eq!(scope(private), ValueScope::Personal);
    assert_eq!(scope(dropped), ValueScope::Team);
    assert_eq!(scope(revenue), ValueScope::Team);

    let merged = merge_entity_values_in(
        &mut tx,
        EntityType::Company,
        &survivor,
        &[first.clone(), second.clone()],
        &locked,
        &[revenue],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(merged.moved.iter().map(|value| value.id).collect::<Vec<_>>(), vec![revenue]);
    let mut deleted: Vec<Uuid> = merged.deleted.iter().map(|value| value.id).collect();
    deleted.sort();
    let mut expected = vec![dropped, private];
    expected.sort();
    assert_eq!(deleted, expected);
    assert_eq!(merged.written.len(), 1);
    assert_eq!(merged.written[0].entity_id, survivor);

    assert_eq!(stored(&pool, revenue).await.unwrap().0, survivor, "the row keeps its id");
    assert_eq!(stored(&pool, kept).await.unwrap().1["value"], "Gold");
    assert_eq!(stored(&pool, dropped).await, None);
    assert_eq!(stored(&pool, private).await, None);
    assert!(stored(&pool, contact).await.is_some(), "a contact with the same id is not the company");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn references_name_the_survivor_once_and_leave_other_records_alone(pool: PgPool) {
    let team = setup(&pool).await;
    let custom = definition(&pool, "Partner", "ENTITY", Some(team), None).await;
    let [survivor, first, second, unrelated] =
        [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()].map(|id| id.to_string());

    let task = value(
        &pool,
        "task-1",
        "DOCUMENT",
        COMPANIES,
        refs(&[("COMPANY", &first), ("COMPANY", &unrelated), ("COMPANY", &survivor)]),
    )
    .await;
    let partner = value(
        &pool,
        "task-2",
        "DOCUMENT",
        &custom.to_string(),
        refs(&[("CONTACT", &second), ("COMPANY", &second)]),
    )
    .await;
    let untouched = value(&pool, "task-3", "DOCUMENT", COMPANIES, refs(&[("COMPANY", &unrelated)])).await;

    let mut tx = pool.begin().await.unwrap();
    let sources = [first.clone(), second.clone()];
    let found = referencing_rows_in(&mut tx, EntityType::Company, &sources)
        .await
        .unwrap();
    let mut expected = vec![task, partner];
    expected.sort();
    assert_eq!(found, expected);

    let retargeted = retarget_references_in(&mut tx, EntityType::Company, &sources, &survivor)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(retargeted.len(), 2);
    let previous = retargeted.iter().find(|row| row.id == task).unwrap();
    assert_eq!(
        previous.previous,
        refs(&[("COMPANY", &first), ("COMPANY", &unrelated), ("COMPANY", &survivor)])
    );
    assert_eq!(
        stored(&pool, task).await.unwrap().1,
        refs(&[("COMPANY", &survivor), ("COMPANY", &unrelated)])
    );
    assert_eq!(
        stored(&pool, partner).await.unwrap().1,
        refs(&[("CONTACT", &second), ("COMPANY", &survivor)])
    );
    assert_eq!(
        stored(&pool, untouched).await.unwrap().1,
        refs(&[("COMPANY", &unrelated)])
    );
}
