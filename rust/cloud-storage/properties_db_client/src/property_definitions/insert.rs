//! Property definitions insert operations.

use crate::error::PropertiesDatabaseError;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_option::PropertyOption;
use models_properties::{DataType, EntityType, db};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// The owner of a user- or team-created property definition. Encodes the
/// "exactly one of user / team" invariant in the type, so neither a both-owners
/// nor a no-owner row is representable. System properties are not created here.
#[derive(Debug, Clone, Copy)]
pub enum DefinitionOwner<'a> {
    /// Owned by a single user.
    User(&'a str),
    /// Owned by a team.
    Team(Uuid),
}

impl<'a> DefinitionOwner<'a> {
    /// Split into the nullable (team_id, user_id) columns the row stores.
    fn into_ids(self) -> (Option<Uuid>, Option<&'a str>) {
        match self {
            DefinitionOwner::User(user_id) => (None, Some(user_id)),
            DefinitionOwner::Team(team_id) => (Some(team_id), None),
        }
    }
}

/// Creates a new property definition.
#[tracing::instrument(skip(db))]
pub async fn create_property_definition(
    db: &Pool<Postgres>,
    owner: DefinitionOwner<'_>,
    display_name: &str,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityType>,
) -> Result<PropertyDefinition> {
    let (team_id, user_id) = owner.into_ids();

    let id = macro_uuid::generate_uuid_v7();

    let row = sqlx::query!(
        r#"
        INSERT INTO property_definitions (
            id,
            team_id,
            user_id,
            display_name,
            data_type,
            is_multi_select,
            specific_entity_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
            id,
            team_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        "#,
        id,
        team_id,
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
        team_id: row.team_id,
        user_id: row.user_id,
        display_name: row.display_name,
        data_type: row.data_type,
        is_multi_select: row.is_multi_select,
        specific_entity_type: row.specific_entity_type.flatten(),
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_system: false, // User-created properties are never system properties
    };

    Ok(PropertyDefinition::from(db_result))
}

/// Creates a property definition with options in a single transaction.
#[tracing::instrument(skip(db, options))]
pub async fn create_property_definition_with_options(
    db: &Pool<Postgres>,
    owner: DefinitionOwner<'_>,
    display_name: &str,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityType>,
    options: Vec<PropertyOption>,
) -> Result<PropertyDefinition> {
    let (team_id, user_id) = owner.into_ids();

    let mut tx = db.begin().await?;

    let id = macro_uuid::generate_uuid_v7();

    let row = match sqlx::query!(
        r#"
        INSERT INTO property_definitions (
            id,
            team_id,
            user_id,
            display_name,
            data_type,
            is_multi_select,
            specific_entity_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
            id,
            team_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at
        "#,
        id,
        team_id,
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
        team_id: row.team_id,
        user_id: row.user_id,
        display_name: row.display_name,
        data_type: row.data_type,
        is_multi_select: row.is_multi_select,
        specific_entity_type: row.specific_entity_type.flatten(),
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_system: false, // User-created properties are never system properties
    };

    for option in options {
        if let Err(e) = crate::property_options::insert::create_property_option_tx(
            &mut tx,
            db_property_def.id,
            option.display_order,
            option.value,
            option.color,
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

/// Returns the owner's tag definition, creating it on first use.
///
/// Tag definitions are TAG-typed, multi-select, and unique per owner (enforced by a partial
/// unique index). A lost create race re-fetches the definition the winner just created.
#[tracing::instrument(skip(db), err)]
pub async fn get_or_create_tag_definition(
    db: &Pool<Postgres>,
    owner: DefinitionOwner<'_>,
) -> Result<PropertyDefinition> {
    let (team_id, user_id) = owner.into_ids();

    if let Some(existing) =
        crate::property_definitions::get::get_tag_definition(db, team_id, user_id).await?
    {
        return Ok(existing);
    }

    match create_property_definition(
        db,
        owner,
        crate::property_definitions::get::TAG_DEFINITION_DISPLAY_NAME,
        DataType::Tag,
        true,
        None,
    )
    .await
    {
        Ok(def) => Ok(def),
        Err(create_err) => {
            match crate::property_definitions::get::get_tag_definition(db, team_id, user_id).await?
            {
                Some(existing) => Ok(existing),
                None => Err(create_err),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use models_properties::service::property_option::PropertyOptionValue;
    use sqlx::{Pool, Postgres};

    fn team_1() -> Uuid {
        "0e000000-0000-0000-0000-000000000001".parse().unwrap()
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_create_property_definition(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let property = create_property_definition(
            &pool,
            DefinitionOwner::Team(team_1()),
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
            DefinitionOwner::User("user1"),
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
    async fn test_create_property_definition_duplicate_name_fails(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Try to create a property with the same name as an existing one in team 1
        let result = create_property_definition(
            &pool,
            DefinitionOwner::Team(team_1()),
            "Test Priority", // Already exists in fixtures
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
                color: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            PropertyOption {
                id: macro_uuid::generate_uuid_v7(),
                property_definition_id: uuid::Uuid::nil(),
                display_order: 1,
                value: PropertyOptionValue::String("Option 2".to_string()),
                color: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
        ];

        let property = create_property_definition_with_options(
            &pool,
            DefinitionOwner::Team(team_1()),
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
            DefinitionOwner::Team(team_1()),
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
            DefinitionOwner::Team(team_1()),
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

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_or_create_tag_definition_is_idempotent(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let owner = DefinitionOwner::Team(team_1());
        let first = get_or_create_tag_definition(&pool, owner).await?;
        assert_eq!(first.data_type, DataType::Tag);
        assert!(first.is_multi_select);

        // A second call returns the same definition rather than creating a duplicate.
        let second = get_or_create_tag_definition(&pool, owner).await?;
        assert_eq!(first.id, second.id);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_tag_definition_none_then_some(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        let before =
            crate::property_definitions::get::get_tag_definition(&pool, Some(team_1()), None)
                .await?;
        assert!(before.is_none());

        let created = get_or_create_tag_definition(&pool, DefinitionOwner::Team(team_1())).await?;

        let after =
            crate::property_definitions::get::get_tag_definition(&pool, Some(team_1()), None)
                .await?;
        assert_eq!(after.map(|d| d.id), Some(created.id));

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("properties"))
    )]
    async fn test_get_or_create_tag_definition_coexists_with_same_named_property(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

        // Owner already has a non-tag property literally named "Tags".
        create_property_definition(
            &pool,
            DefinitionOwner::Team(team_1()),
            "Tags",
            DataType::String,
            false,
            None,
        )
        .await?;

        // Provisioning the tag set still succeeds: tag definitions are exempt from the
        // display-name uniqueness that applies to user-created properties.
        let tag_def = get_or_create_tag_definition(&pool, DefinitionOwner::Team(team_1())).await?;
        assert_eq!(tag_def.data_type, DataType::Tag);

        let again = get_or_create_tag_definition(&pool, DefinitionOwner::Team(team_1())).await?;
        assert_eq!(tag_def.id, again.id);

        Ok(())
    }
}
