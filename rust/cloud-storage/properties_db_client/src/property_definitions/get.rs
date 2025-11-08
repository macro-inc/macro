//! Property definitions get operations.

use crate::error::PropertiesDatabaseError;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::{DataType, EntityType, db};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Gets property definitions based on optional organization and optional user access.
#[tracing::instrument(skip(db))]
pub async fn get_properties(
    db: &Pool<Postgres>,
    organization_id: Option<i32>,
    user_id: Option<&str>,
) -> Result<Vec<PropertyDefinition>> {
    let rows = sqlx::query!(
        r#"
        SELECT 
            id,
            organization_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        FROM property_definitions
        WHERE 
            ($1::int IS NOT NULL AND organization_id = $1) 
            OR ($2::text IS NOT NULL AND user_id = $2)
        ORDER BY LOWER(display_name) ASC
        "#,
        organization_id,
        user_id
    )
    .fetch_all(db)
    .await?;

    let result = rows
        .into_iter()
        .map(|row| {
            let db_def = db::PropertyDefinition {
                id: row.id,
                organization_id: row.organization_id,
                user_id: row.user_id,
                display_name: row.display_name,
                data_type: row.data_type,
                is_multi_select: row.is_multi_select,
                specific_entity_type: row.specific_entity_type.flatten(),
                created_at: row.created_at,
                updated_at: row.updated_at,
            };
            PropertyDefinition::from(db_def)
        })
        .collect();

    Ok(result)
}

/// Gets a single property definition by ID.
#[tracing::instrument(skip(db))]
pub async fn get_property_definition(
    db: &Pool<Postgres>,
    property_id: uuid::Uuid,
) -> Result<Option<PropertyDefinition>> {
    let row = sqlx::query!(
        r#"
        SELECT 
            id,
            organization_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        FROM property_definitions
        WHERE id = $1
        "#,
        property_id
    )
    .fetch_optional(db)
    .await?;

    let result = row.map(|row| {
        let db_prop = db::PropertyDefinition {
            id: row.id,
            organization_id: row.organization_id,
            user_id: row.user_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type.flatten(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        PropertyDefinition::from(db_prop)
    });

    Ok(result)
}

/// Gets a single property definition by ID with ownership validation.
/// Returns None if the property doesn't exist or if the user doesn't own it.
#[tracing::instrument(skip(db))]
pub async fn get_property_definition_with_owner(
    db: &Pool<Postgres>,
    property_id: uuid::Uuid,
    user_id: &str,
    organization_id: Option<i32>,
) -> Result<Option<PropertyDefinition>> {
    let row = sqlx::query!(
        r#"
        SELECT 
            id,
            organization_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        FROM property_definitions
        WHERE id = $1
          AND (
            user_id = $2
            OR ($3::int IS NOT NULL AND organization_id = $3)
          )
        "#,
        property_id,
        user_id,
        organization_id
    )
    .fetch_optional(db)
    .await?;

    let result = row.map(|row| {
        let db_prop = db::PropertyDefinition {
            id: row.id,
            organization_id: row.organization_id,
            user_id: row.user_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type.flatten(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        PropertyDefinition::from(db_prop)
    });

    Ok(result)
}

/// Gets property definitions with options based on organization and optional user access.
#[tracing::instrument(skip(db))]
pub async fn get_properties_with_options(
    db: &Pool<Postgres>,
    organization_id: Option<i32>,
    user_id: Option<&str>,
) -> Result<Vec<PropertyDefinitionWithOptions>> {
    let rows = sqlx::query!(
        r#"
        SELECT 
            pd.id,
            pd.organization_id,
            pd.user_id,
            pd.display_name,
            pd.data_type as "data_type: DataType",
            pd.is_multi_select,
            pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
            pd.created_at,
            pd.updated_at,
            po.id as "option_id?",
            po.display_order as "option_display_order?",
            po.number_value as option_number_value,
            po.string_value as option_string_value,
            po.created_at as "option_created_at?",
            po.updated_at as "option_updated_at?"
        FROM property_definitions pd
        LEFT JOIN property_options po ON pd.id = po.property_definition_id
        WHERE 
            ($1::int IS NOT NULL AND pd.organization_id = $1) 
            OR ($2::text IS NOT NULL AND pd.user_id = $2)
        ORDER BY LOWER(pd.display_name), po.display_order, po.number_value, LOWER(po.string_value)
        "#,
        organization_id,
        user_id
    )
    .fetch_all(db)
    .await?;

    let mut property_map: HashMap<Uuid, PropertyDefinitionWithOptions> = HashMap::new();

    for row in rows {
        let owner = models_properties::PropertyOwner::from_optional_ids(
            row.organization_id,
            row.user_id.clone(),
        )
        .unwrap();

        let property_def = PropertyDefinition {
            id: row.id,
            owner,
            display_name: row.display_name.clone(),
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type.flatten(),
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_metadata: false,
        };

        let entry = property_map
            .entry(row.id)
            .or_insert_with(|| PropertyDefinitionWithOptions {
                definition: property_def,
                property_options: Vec::new(),
            });

        // Only process options if option_id is present (from LEFT JOIN)
        if let Some(option_id) = row.option_id
            && (row.option_number_value.is_some() || row.option_string_value.is_some())
            && (row.data_type == DataType::SelectNumber || row.data_type == DataType::SelectString)
        {
            let value = match (row.option_number_value, &row.option_string_value) {
                (Some(num), None) => PropertyOptionValue::Number(num),
                (None, Some(str)) => PropertyOptionValue::String(str.clone()),
                (Some(_), Some(_)) => {
                    return Err(
                        models_properties::db::DbConversionError::PropertyOptionBothValuesSet {
                            id: option_id,
                        }
                        .into(),
                    );
                }
                (None, None) => {
                    return Err(
                        models_properties::db::DbConversionError::PropertyOptionNoValueSet {
                            id: option_id,
                        }
                        .into(),
                    );
                }
            };

            let option = PropertyOption {
                id: option_id,
                property_definition_id: row.id,
                display_order: row.option_display_order.unwrap_or(0),
                value,
                created_at: row.option_created_at.unwrap_or(row.created_at),
                updated_at: row.option_updated_at.unwrap_or(row.updated_at),
            };
            entry.property_options.push(option);
        }
    }

    let mut results: Vec<PropertyDefinitionWithOptions> = property_map.into_values().collect();

    results.sort_by(|a, b| {
        a.definition
            .display_name
            .to_lowercase()
            .cmp(&b.definition.display_name.to_lowercase())
    });

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_properties_by_organization(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE

        let properties = get_properties(&pool, Some(1), None).await?;

        assert_eq!(properties.len(), 10); // Organization 1 has 10 properties

        // Verify they are sorted by display name (case-insensitive alphabetical)
        assert_eq!(properties[0].display_name, "Assigned To");
        assert_eq!(properties[1].display_name, "Budget");
        assert_eq!(properties[2].display_name, "Completed");
        assert_eq!(properties[3].display_name, "Department");
        assert_eq!(properties[4].display_name, "Description");
        assert_eq!(properties[5].display_name, "Due Date");
        assert_eq!(properties[6].display_name, "Priority");
        assert_eq!(properties[7].display_name, "Relevant Documents");
        assert_eq!(properties[8].display_name, "Score");
        assert_eq!(properties[9].display_name, "Website");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_properties_by_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_properties(&pool, None, Some("user1")).await?;

        assert_eq!(properties.len(), 2); // User1 has 2 properties
        assert_eq!(properties[0].display_name, "Notes");
        assert_eq!(properties[1].display_name, "Personal Priority");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_definition_by_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();
        let property = get_property_definition(&pool, property_id).await?;

        assert!(property.is_some());
        let property = property.unwrap();
        assert_eq!(property.display_name, "Priority");
        assert_eq!(property.data_type, DataType::SelectString);
        assert!(!property.is_multi_select);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_definition_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "00000000-0000-0000-0000-000000000000"
            .parse::<Uuid>()
            .unwrap();
        let property = get_property_definition(&pool, property_id).await?;

        assert!(property.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_property_definition_with_owner(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();

        // User in organization 1 should have access
        let property =
            get_property_definition_with_owner(&pool, property_id, "user1", Some(1)).await?;
        assert!(property.is_some());

        // User not in organization should not have access
        let property =
            get_property_definition_with_owner(&pool, property_id, "user1", Some(99)).await?;
        assert!(property.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_properties_with_options(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_properties_with_options(&pool, Some(1), None).await?;

        assert_eq!(properties.len(), 10);

        // Find Priority property which should have 4 options
        let priority_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Priority")
            .unwrap();

        assert_eq!(priority_prop.property_options.len(), 4);
        assert_eq!(priority_prop.property_options[0].display_order, 0);

        // Verify the options are properly ordered and have correct values
        if let models_properties::service::property_option::PropertyOptionValue::String(val) =
            &priority_prop.property_options[0].value
        {
            assert_eq!(val, "Low");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_properties_with_options_includes_non_select(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_properties_with_options(&pool, Some(1), None).await?;

        // Find non-select properties (should have 0 options)
        let completed_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Completed")
            .unwrap();

        assert_eq!(completed_prop.definition.data_type, DataType::Boolean);
        assert_eq!(completed_prop.property_options.len(), 0);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_properties_with_number_options(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_properties_with_options(&pool, Some(1), None).await?;

        // Find Score property which has number options
        let score_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Score")
            .unwrap();

        assert_eq!(score_prop.property_options.len(), 5);
        assert_eq!(score_prop.definition.data_type, DataType::SelectNumber);

        // Check first option is number 1.0
        if let models_properties::service::property_option::PropertyOptionValue::Number(val) =
            score_prop.property_options[0].value
        {
            assert_eq!(val, 4.0);
        } else {
            panic!("Expected number value");
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_properties_with_options_multi_select(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let properties = get_properties_with_options(&pool, Some(1), None).await?;

        // Find Department property which is multi-select
        let dept_prop = properties
            .iter()
            .find(|p| p.definition.display_name == "Department")
            .unwrap();

        assert!(dept_prop.definition.is_multi_select);
        assert_eq!(dept_prop.definition.data_type, DataType::SelectString);
        assert_eq!(dept_prop.property_options.len(), 3);

        // Verify the options are properly ordered and have correct values
        if let models_properties::service::property_option::PropertyOptionValue::String(val) =
            &dept_prop.property_options[0].value
        {
            assert_eq!(val, "Engineering");
        } else {
            panic!("Expected string value");
        }

        if let models_properties::service::property_option::PropertyOptionValue::String(val) =
            &dept_prop.property_options[1].value
        {
            assert_eq!(val, "Human Resources");
        } else {
            panic!("Expected string value");
        }

        if let models_properties::service::property_option::PropertyOptionValue::String(val) =
            &dept_prop.property_options[2].value
        {
            assert_eq!(val, "Marketing");
        } else {
            panic!("Expected string value");
        }

        Ok(())
    }
}
