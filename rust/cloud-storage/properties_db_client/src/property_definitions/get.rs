//! Property definitions get operations.

use crate::error::PropertiesDatabaseError;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::{DataType, EntityType, db};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Gets a single property definition by ID (includes system properties).
#[tracing::instrument(skip(db))]
pub async fn get_property_definition(
    db: &Pool<Postgres>,
    property_id: uuid::Uuid,
) -> Result<Option<PropertyDefinition>> {
    let row = sqlx::query!(
        r#"
        SELECT
            id,
            team_id,
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
    .fetch_optional(db)
    .await?;

    let result = row.map(|row| {
        let db_prop = db::PropertyDefinition {
            id: row.id,
            team_id: row.team_id,
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

/// Gets a single property definition by ID with ownership validation.
/// Returns None if the property doesn't exist, if the caller doesn't own it, or if it's a system property.
/// The caller owns it when it is their user property, or a property of the team they belong to.
/// System properties don't have owners and should be fetched via `get_property_definition`.
#[tracing::instrument(skip(db))]
pub async fn get_property_definition_with_owner(
    db: &Pool<Postgres>,
    property_id: uuid::Uuid,
    user_id: &str,
    team_id: Option<Uuid>,
) -> Result<Option<PropertyDefinition>> {
    let row = sqlx::query!(
        r#"
        SELECT
            id,
            team_id,
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
          AND is_system = FALSE
          AND (
            user_id = $2
            OR ($3::uuid IS NOT NULL AND team_id = $3)
          )
        "#,
        property_id,
        user_id,
        team_id
    )
    .fetch_optional(db)
    .await?;

    let result = row.map(|row| {
        let db_prop = db::PropertyDefinition {
            id: row.id,
            team_id: row.team_id,
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

/// Display name used for the auto-provisioned tag definition.
pub const TAG_DEFINITION_DISPLAY_NAME: &str = "Tags";

/// Gets the single tag definition owned by the given team or user, if it exists.
/// Exactly one of `team_id` / `user_id` is expected to be set.
#[tracing::instrument(skip(db), err)]
pub async fn get_tag_definition(
    db: &Pool<Postgres>,
    team_id: Option<Uuid>,
    user_id: Option<&str>,
) -> Result<Option<PropertyDefinition>> {
    let row = sqlx::query!(
        r#"
        SELECT
            id,
            team_id,
            user_id,
            display_name,
            data_type as "data_type: DataType",
            is_multi_select,
            specific_entity_type as "specific_entity_type: Option<EntityType>",
            created_at,
            updated_at,
            is_system
        FROM property_definitions
        WHERE data_type = $3
          AND (
            ($1::uuid IS NOT NULL AND team_id = $1)
            OR ($2::text IS NOT NULL AND user_id = $2)
          )
        LIMIT 1
        "#,
        team_id,
        user_id,
        DataType::Tag as DataType
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| {
        PropertyDefinition::from(db::PropertyDefinition {
            id: row.id,
            team_id: row.team_id,
            user_id: row.user_id,
            display_name: row.display_name,
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type.flatten(),
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_system: row.is_system,
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    fn team_1() -> Uuid {
        "0e000000-0000-0000-0000-000000000001".parse().unwrap()
    }

    fn team_2() -> Uuid {
        "0e000000-0000-0000-0000-000000000002".parse().unwrap()
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
        assert_eq!(property.display_name, "Test Priority");
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

        let team_property_id = "11111111-1111-1111-1111-111111111111"
            .parse::<Uuid>()
            .unwrap();

        // The team owner can access the team property.
        let property =
            get_property_definition_with_owner(&pool, team_property_id, "user1", Some(team_1()))
                .await?;
        assert!(property.is_some());

        // A different member of the same team can also access it.
        let property =
            get_property_definition_with_owner(&pool, team_property_id, "user3", Some(team_1()))
                .await?;
        assert!(property.is_some());

        // A user on a different team cannot access it.
        let property =
            get_property_definition_with_owner(&pool, team_property_id, "user2", Some(team_2()))
                .await?;
        assert!(property.is_none());

        // A user with no team cannot access it.
        let property =
            get_property_definition_with_owner(&pool, team_property_id, "user2", None).await?;
        assert!(property.is_none());

        // The owning user can access their own user property.
        let user_property_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
            .parse::<Uuid>()
            .unwrap();
        let property =
            get_property_definition_with_owner(&pool, user_property_id, "user1", Some(team_1()))
                .await?;
        assert!(property.is_some());

        // A different user cannot access someone else's user property.
        let property =
            get_property_definition_with_owner(&pool, user_property_id, "user3", Some(team_1()))
                .await?;
        assert!(property.is_none());

        Ok(())
    }
}
