//! Property definitions insert operations.

use crate::error::PropertiesDatabaseError;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::PropertyOption;
use models_properties::{DataType, EntityType, db};
use sqlx::{Pool, Postgres};

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Creates a new property definition.
#[tracing::instrument(skip(db))]
pub async fn create_property_definition(
    db: &Pool<Postgres>,
    organization_id: Option<i32>,
    user_id: Option<&str>,
    display_name: &str,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityType>,
) -> Result<PropertyDefinition> {
    if organization_id.is_none() && user_id.is_none() {
        return Err(PropertiesDatabaseError::MissingOwner);
    }

    let id = macro_uuid::generate_uuid_v7();

    let row = sqlx::query!(
        r#"
        INSERT INTO property_definitions (
            id,
            organization_id, 
            user_id, 
            display_name, 
            data_type, 
            is_multi_select,
            specific_entity_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING 
            id,
            organization_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        "#,
        id,
        organization_id,
        user_id,
        display_name,
        data_type as DataType,
        is_multi_select,
        specific_entity_type as Option<EntityType>
    )
    .fetch_one(db)
    .await?;

    let db_result = db::PropertyDefinition {
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

    Ok(PropertyDefinition::from(db_result))
}

/// Creates a property definition with options in a single transaction.
#[tracing::instrument(skip(db, options))]
#[expect(
    clippy::too_many_arguments,
    reason = "no good reason but too hard to fix right now"
)]
pub async fn create_property_definition_with_options(
    db: &Pool<Postgres>,
    organization_id: Option<i32>,
    user_id: Option<&str>,
    display_name: &str,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityType>,
    options: Vec<PropertyOption>,
) -> Result<PropertyDefinition> {
    if organization_id.is_none() && user_id.is_none() {
        return Err(PropertiesDatabaseError::MissingOwner);
    }

    let mut tx = db.begin().await?;

    let id = macro_uuid::generate_uuid_v7();

    let row = match sqlx::query!(
        r#"
        INSERT INTO property_definitions (
            id,
            organization_id, 
            user_id, 
            display_name, 
            data_type, 
            is_multi_select,
            specific_entity_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING 
            id,
            organization_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        "#,
        id,
        organization_id,
        user_id,
        display_name,
        data_type as DataType,
        is_multi_select,
        specific_entity_type as Option<EntityType>
    )
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(
                error = ?e,
                display_name = %display_name,
                "property definition insert failed, rolling back transaction"
            );
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(
                    error = ?rollback_err,
                    "failed to rollback transaction after property definition insert error"
                );
            }
            return Err(e.into());
        }
    };

    let db_property_def = db::PropertyDefinition {
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

    for option in options {
        if let Err(e) = crate::property_options::insert::create_property_option_tx(
            &mut tx,
            db_property_def.id,
            option.display_order,
            option.value,
        )
        .await
        {
            tracing::error!(
                error = ?e,
                property_definition_id = %db_property_def.id,
                "property option creation failed, rolling back transaction"
            );
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(
                    error = ?rollback_err,
                    "failed to rollback transaction after property option insert error"
                );
            }
            return Err(e);
        }
    }

    match tx.commit().await {
        Ok(_) => Ok(db_property_def.into()),
        Err(e) => {
            tracing::error!(
                error = ?e,
                "failed to commit transaction for property definition with options"
            );
            Err(e.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use models_properties::service::property_option::PropertyOptionValue;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property = create_property_definition(
            &pool,
            Some(1),
            None,
            "New Test Property",
            DataType::String,
            false,
            None,
        )
        .await?;

        assert_eq!(property.display_name, "New Test Property");
        assert_eq!(property.data_type, DataType::String);
        assert!(!property.is_multi_select);
        assert!(property.specific_entity_type.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition_user_owned(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property = create_property_definition(
            &pool,
            None,
            Some("user1"),
            "User Property",
            DataType::Number,
            false,
            None,
        )
        .await?;

        assert_eq!(property.display_name, "User Property");
        assert_eq!(property.data_type, DataType::Number);
        assert!(property.specific_entity_type.is_none());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition_no_owner_fails(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let result = create_property_definition(
            &pool,
            None,
            None,
            "No Owner Property",
            DataType::String,
            false,
            None,
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            PropertiesDatabaseError::MissingOwner => {}
            _ => panic!("Expected MissingOwner error"),
        }

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition_duplicate_name_fails(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Try to create a property with the same name as an existing one in org 1
        let result = create_property_definition(
            &pool,
            Some(1),
            None,
            "Priority", // Already exists in fixtures
            DataType::String,
            false,
            None,
        )
        .await;

        assert!(result.is_err());

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition_with_options(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let options = vec![
            PropertyOption {
                id: macro_uuid::generate_uuid_v7(),
                property_definition_id: uuid::Uuid::nil(), // Will be set by the function
                display_order: 0,
                value: PropertyOptionValue::String("Option 1".to_string()),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            PropertyOption {
                id: macro_uuid::generate_uuid_v7(),
                property_definition_id: uuid::Uuid::nil(),
                display_order: 1,
                value: PropertyOptionValue::String("Option 2".to_string()),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
        ];

        let property = create_property_definition_with_options(
            &pool,
            Some(1),
            None,
            "Property With Options",
            DataType::SelectString,
            false,
            None,
            options,
        )
        .await?;

        assert_eq!(property.display_name, "Property With Options");
        assert_eq!(property.data_type, DataType::SelectString);

        // Verify options were created
        let created_options =
            crate::property_options::get::get_property_options(&pool, property.id).await?;

        assert_eq!(created_options.len(), 2);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition_multi_select(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property = create_property_definition(
            &pool,
            Some(1),
            None,
            "Multi Select Property",
            DataType::SelectString,
            true, // multi-select
            None,
        )
        .await?;

        assert_eq!(property.display_name, "Multi Select Property");
        assert!(property.is_multi_select);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition_specific_entity(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property = create_property_definition(
            &pool,
            Some(1),
            None,
            "Multi Select Documents",
            DataType::Entity,
            true,
            Some(EntityType::User),
        )
        .await?;

        assert_eq!(property.display_name, "Multi Select Documents");
        assert!(property.is_multi_select);
        assert_eq!(property.specific_entity_type, Some(EntityType::User));

        Ok(())
    }
}
