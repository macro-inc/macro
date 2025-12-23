//! Property definition query helpers.

use models_properties::service::property_definition::PropertyDefinition;
use models_properties::{DataType, EntityType, db};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Gets a single property definition by ID (includes system properties).
pub async fn get_property_definition(
    pool: &Pool<Postgres>,
    property_id: Uuid,
) -> anyhow::Result<Option<PropertyDefinition>> {
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
            updated_at,
            is_system
        FROM property_definitions
        WHERE id = $1
        "#,
        property_id
    )
    .fetch_optional(pool)
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
            is_system: row.is_system,
        };
        PropertyDefinition::from(db_prop)
    });

    Ok(result)
}
