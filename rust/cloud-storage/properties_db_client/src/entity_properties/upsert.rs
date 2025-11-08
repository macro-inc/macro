//! Entity property upsert operations.

use crate::error::PropertiesDatabaseError;
use models_properties::EntityType;
use models_properties::service::property_value::PropertyValue;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Upserts entity property values for a given entity and property definition.
/// Values are stored as JSONB with tagged union structure.
/// If value is None, the property is set to NULL (clearing the value).
#[tracing::instrument(skip(db, value))]
pub async fn upsert_entity_property_values(
    db: &Pool<Postgres>,
    entity_id: &str,
    entity_type: EntityType,
    property_definition_id: Uuid,
    value: Option<PropertyValue>,
) -> Result<()> {
    let id = macro_uuid::generate_uuid_v7();

    // Serialize PropertyValue to JSONB (or NULL if None)
    let value_json = match value {
        Some(v) => serde_json::to_value(&v).map_err(|e| {
            tracing::error!(
                error = ?e,
                entity_id = %entity_id,
                property_definition_id = %property_definition_id,
                "failed to serialize property value to JSON"
            );
            PropertiesDatabaseError::SerializationError(e)
        })?,
        None => serde_json::Value::Null,
    };

    tracing::debug!(
        entity_id = %entity_id,
        property_definition_id = %property_definition_id,
        value_json = ?value_json,
        has_value = !value_json.is_null(),
        "upserting entity property with JSONB value"
    );

    // Single UPSERT operation - handles both INSERT and UPDATE cases
    // When value is None, JSONB will be NULL, effectively clearing the value while keeping the property attached
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (entity_id, entity_type, property_definition_id) 
        DO UPDATE SET 
            values = EXCLUDED.values,
            updated_at = NOW()
        "#,
        id,
        entity_id,
        entity_type as EntityType,
        property_definition_id,
        value_json
    )
    .execute(db)
    .await
    .map_err(|e| {
        tracing::error!(
            error = ?e,
            entity_id = %entity_id,
            property_definition_id = %property_definition_id,
            "failed to upsert entity property"
        );
        PropertiesDatabaseError::Query(e)
    })?;

    tracing::info!(
        entity_id = %entity_id,
        property_definition_id = %property_definition_id,
        has_value = !value_json.is_null(),
        "successfully upserted entity property"
    );

    Ok(())
}

/// Validates property options by checking if they exist for the property definition.
/// This should be called at the service layer before upserting.
pub async fn validate_property_options(
    db: &Pool<Postgres>,
    property_definition_id: Uuid,
    option_ids: &[Uuid],
) -> Result<()> {
    if option_ids.is_empty() {
        return Ok(());
    }

    tracing::debug!(
        property_definition_id = %property_definition_id,
        option_ids = ?option_ids,
        "validating property options"
    );

    // Count how many of the provided option IDs actually exist for this property
    let valid_count = crate::property_options::get::count_property_options_by_ids(
        db,
        property_definition_id,
        option_ids,
    )
    .await?;

    if valid_count != option_ids.len() as i64 {
        tracing::warn!(
            property_definition_id = %property_definition_id,
            provided_count = option_ids.len(),
            valid_count = valid_count,
            "property option validation failed"
        );
        return Err(PropertiesDatabaseError::InvalidPropertyOptions {
            provided: option_ids.len(),
            valid: valid_count,
            property_id: property_definition_id,
        });
    }

    tracing::debug!(
        property_definition_id = %property_definition_id,
        option_count = option_ids.len(),
        "property options validated successfully"
    );

    Ok(())
}

/// Extracts all option IDs from PropertyValue for validation
pub fn extract_option_ids(value: &Option<PropertyValue>) -> Vec<Uuid> {
    match value {
        Some(PropertyValue::SelectOption(ids)) => ids.clone(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use models_properties::EntityReference;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_insert(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        let desc_prop_before = properties_before
            .iter()
            .find(|p| p.definition.display_name == "Description");
        assert!(desc_prop_before.is_none());

        let property_id = "88888888-8888-8888-8888-888888888888"
            .parse::<Uuid>()
            .unwrap();
        let value = PropertyValue::Str("New description".to_string());

        upsert_entity_property_values(
            &pool,
            "doc2",
            EntityType::Document,
            property_id,
            Some(value),
        )
        .await?;

        // Verify it was inserted
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        let desc_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Description");

        assert!(desc_prop.is_some());
        let desc_prop = desc_prop.unwrap();

        if let Some(PropertyValue::Str(val)) = &desc_prop.value {
            assert_eq!(val, "New description");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_update(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "88888888-8888-8888-8888-888888888888"
            .parse::<Uuid>()
            .unwrap();
        let new_value = PropertyValue::Str("Updated description".to_string());

        // Update existing property
        upsert_entity_property_values(
            &pool,
            "doc1",
            EntityType::Document,
            property_id,
            Some(new_value),
        )
        .await?;

        // Verify it was updated
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        let desc_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Description")
            .unwrap();

        if let Some(PropertyValue::Str(val)) = &desc_prop.value {
            assert_eq!(val, "Updated description");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_clear_value(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "88888888-8888-8888-8888-888888888888"
            .parse::<Uuid>()
            .unwrap();

        // Clear the value by passing None
        upsert_entity_property_values(&pool, "doc1", EntityType::Document, property_id, None)
            .await?;

        // Verify value is now NULL
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc1",
            EntityType::Document,
        )
        .await?;
        let desc_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Description")
            .unwrap();

        assert!(desc_prop.value.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_boolean(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "55555555-5555-5555-5555-555555555555"
            .parse::<Uuid>()
            .unwrap();
        let value = PropertyValue::Bool(true);

        upsert_entity_property_values(
            &pool,
            "proj1",
            EntityType::Project,
            property_id,
            Some(value),
        )
        .await?;

        // Verify it was set
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "proj1",
            EntityType::Project,
        )
        .await?;
        let completed_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Completed");

        assert!(completed_prop.is_some());
        if let Some(PropertyValue::Bool(val)) = completed_prop.unwrap().value {
            assert!(val);
        } else {
            panic!("Expected boolean value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_number(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "77777777-7777-7777-7777-777777777777"
            .parse::<Uuid>()
            .unwrap();
        let value = PropertyValue::Num(75000.99);

        upsert_entity_property_values(
            &pool,
            "proj1",
            EntityType::Project,
            property_id,
            Some(value),
        )
        .await?;

        // Verify it was updated
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "proj1",
            EntityType::Project,
        )
        .await?;
        let budget_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Budget")
            .unwrap();

        if let Some(PropertyValue::Num(val)) = budget_prop.value {
            assert_eq!(val, 75000.99);
        } else {
            panic!("Expected number value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_select_option(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        let priority_prop_before = properties_before
            .iter()
            .find(|p| p.definition.display_name == "Priority")
            .unwrap();
        if let Some(PropertyValue::SelectOption(ids)) = &priority_prop_before.value {
            assert_eq!(ids.len(), 1);
            assert_eq!(
                ids[0],
                "10111111-1111-1111-1111-111111111111"
                    .parse::<Uuid>()
                    .unwrap()
            );
        } else {
            panic!("Expected select option value");
        }

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let option_id = "10111111-1111-1111-1111-111111111112"
            .parse::<Uuid>()
            .unwrap();
        let value = PropertyValue::SelectOption(vec![option_id]);

        upsert_entity_property_values(
            &pool,
            "doc2",
            EntityType::Document,
            property_id,
            Some(value),
        )
        .await?;

        // Verify it was updated
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "doc2",
            EntityType::Document,
        )
        .await?;
        let priority_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Priority")
            .unwrap();

        if let Some(PropertyValue::SelectOption(ids)) = &priority_prop.value {
            assert_eq!(ids.len(), 1);
            assert_eq!(ids[0], option_id);
        } else {
            panic!("Expected select option value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_upsert_entity_property_values_entity_reference(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Verify it was updated
        let properties_before = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "proj1",
            EntityType::Project,
        )
        .await?;
        let assigned_prop_before = properties_before
            .iter()
            .find(|p| p.definition.display_name == "Assigned To")
            .unwrap();

        if let Some(PropertyValue::EntityRef(refs)) = &assigned_prop_before.value {
            assert_eq!(refs.len(), 1);
            assert_eq!(refs[0].entity_id, "user1");
            assert_eq!(refs[0].entity_type, EntityType::User);
        } else {
            panic!("Expected entity reference value");
        }

        let property_id = "33333333-3333-3333-3333-333333333333"
            .parse::<Uuid>()
            .unwrap();
        let entity_ref_1 = EntityReference {
            entity_type: EntityType::User,
            entity_id: "user1".to_string(),
        };
        let entity_ref_2 = EntityReference {
            entity_type: EntityType::User,
            entity_id: "user2".to_string(),
        };
        let value = PropertyValue::EntityRef(vec![entity_ref_1, entity_ref_2]);

        upsert_entity_property_values(
            &pool,
            "proj1",
            EntityType::Project,
            property_id,
            Some(value),
        )
        .await?;

        // Verify it was updated
        let properties = crate::entity_properties::get::get_entity_properties_values(
            &pool,
            "proj1",
            EntityType::Project,
        )
        .await?;
        let assigned_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Assigned To")
            .unwrap();

        if let Some(PropertyValue::EntityRef(refs)) = &assigned_prop.value {
            assert_eq!(refs.len(), 2);
            assert_eq!(refs[0].entity_id, "user1");
            assert_eq!(refs[0].entity_type, EntityType::User);
            assert_eq!(refs[1].entity_id, "user2");
            assert_eq!(refs[1].entity_type, EntityType::User);
        } else {
            panic!("Expected entity reference value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_validate_property_options_valid(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let option_ids = vec![
            "10111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "10111111-1111-1111-1111-111111111112"
                .parse::<Uuid>()
                .unwrap(),
        ];

        let result = validate_property_options(&pool, property_id, &option_ids).await;
        assert!(result.is_ok());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_validate_property_options_invalid(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let option_ids = vec![
            "10111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "00000000-0000-0000-0000-000000000000"
                .parse::<Uuid>()
                .unwrap(), // Invalid
        ];

        let result = validate_property_options(&pool, property_id, &option_ids).await;
        assert!(result.is_err());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_extract_option_ids(_pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let option_ids = vec![
            "10111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "10111111-1111-1111-1111-111111111112"
                .parse::<Uuid>()
                .unwrap(),
        ];
        let value = Some(PropertyValue::SelectOption(option_ids.clone()));

        let extracted = extract_option_ids(&value);
        assert_eq!(extracted, option_ids);

        // Test with non-select option
        let value2 = Some(PropertyValue::Str("test".to_string()));
        let extracted2 = extract_option_ids(&value2);
        assert_eq!(extracted2.len(), 0);

        Ok(())
    }
}
