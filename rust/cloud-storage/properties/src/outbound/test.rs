//! Integration tests for PropertiesPgRepo using sqlx and real migrations.

use super::properties_pg_repo::PropertiesPgRepo;
use crate::domain::ports::PropertiesRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::{EntityType, service::property_value::PropertyValue};
use sqlx::{Pool, Postgres};
use system_properties::{StatusOption, SystemPropertyKey};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn updates_existing_property(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let entity_id = "entity-status-incomplete";
    let property_id = SystemPropertyKey::STATUS_UUID;

    // Update value to completed
    repo.update_entity_property_value_if_exists(
        entity_id,
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID,
        ])),
    )
    .await?;

    // Verify
    let stored: serde_json::Value = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT values FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(property_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(
        stored,
        serde_json::json!({"type": "SelectOption", "value": [StatusOption::COMPLETED_UUID]})
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn no_op_when_property_not_attached(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let entity_id = "entity-no-status";
    let property_id = SystemPropertyKey::STATUS_UUID;

    repo.update_entity_property_value_if_exists(
        entity_id,
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID,
        ])),
    )
    .await?;

    let count: i64 = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(property_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0, "no rows should be created or updated");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties_seed"))
)]
async fn idempotent_when_already_completed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let entity_id = "entity-status-complete";
    let property_id = SystemPropertyKey::STATUS_UUID;

    repo.update_entity_property_value_if_exists(
        entity_id,
        EntityType::Document,
        property_id,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::COMPLETED_UUID,
        ])),
    )
    .await?;

    let stored: serde_json::Value = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT values FROM entity_properties
        WHERE entity_id = $1 AND entity_type = $2 AND property_definition_id = $3
        "#,
    )
    .bind(entity_id)
    .bind(EntityType::Document)
    .bind(property_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(
        stored,
        serde_json::json!({"type": "SelectOption", "value": [StatusOption::COMPLETED_UUID]})
    );

    Ok(())
}
