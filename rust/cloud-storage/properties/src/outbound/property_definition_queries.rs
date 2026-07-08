//! Property definition query helpers.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::{DataType, EntityType, db};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::model::PropertyDefinitionOwner;

/// Gets a single property definition by ID (includes system properties).
pub async fn get_property_definition(
    pool: &Pool<Postgres>,
    property_id: Uuid,
) -> anyhow::Result<Option<PropertyDefinition>> {
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
    .fetch_optional(pool)
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
#[tracing::instrument(skip(pool))]
pub async fn get_property_definition_with_owner(
    pool: &Pool<Postgres>,
    property_id: Uuid,
    user_id: &MacroUserIdStr<'_>,
    team_id: Option<Uuid>,
) -> anyhow::Result<Option<PropertyDefinition>> {
    let user_id: &str = user_id.as_ref();
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
    .fetch_optional(pool)
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

/// Gets property definitions based on optional team and optional user access.
/// Set `include_system` to true to also include system properties.
#[tracing::instrument(skip(pool))]
pub async fn list_property_definitions(
    pool: &Pool<Postgres>,
    team_id: Option<Uuid>,
    user_id: Option<&MacroUserIdStr<'_>>,
    include_system: bool,
) -> anyhow::Result<Vec<PropertyDefinition>> {
    let user_id: Option<&str> = user_id.map(|u| u.as_ref());
    let rows = sqlx::query!(
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
        WHERE
            ($3 AND is_system)
            OR (
                ($1::uuid IS NOT NULL AND team_id = $1)
                OR ($2::text IS NOT NULL AND user_id = $2)
            )
        ORDER BY LOWER(display_name) ASC
        "#,
        team_id,
        user_id,
        include_system
    )
    .fetch_all(pool)
    .await?;

    let result = rows
        .into_iter()
        .map(|row| {
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
        })
        .collect();

    Ok(result)
}

/// Gets property definitions with options based on team and optional user access.
/// Set `include_system` to true to also include system properties.
#[tracing::instrument(skip(pool))]
pub async fn list_property_definitions_with_options(
    pool: &Pool<Postgres>,
    team_id: Option<Uuid>,
    user_id: Option<&MacroUserIdStr<'_>>,
    include_system: bool,
) -> anyhow::Result<Vec<PropertyDefinitionWithOptions>> {
    let user_id: Option<&str> = user_id.map(|u| u.as_ref());
    let rows = sqlx::query!(
        r#"
        SELECT
            pd.id,
            pd.team_id,
            pd.user_id,
            pd.display_name,
            pd.data_type as "data_type: DataType",
            pd.is_multi_select,
            pd.specific_entity_type as "specific_entity_type: Option<EntityType>",
            pd.created_at,
            pd.updated_at,
            pd.is_system,
            po.id as "option_id?",
            po.display_order as "option_display_order?",
            po.number_value as option_number_value,
            po.string_value as option_string_value,
            po.color as option_color,
            po.created_at as "option_created_at?",
            po.updated_at as "option_updated_at?"
        FROM property_definitions pd
        LEFT JOIN property_options po ON pd.id = po.property_definition_id
        WHERE
            ($3 AND pd.is_system)
            OR (
                ($1::uuid IS NOT NULL AND pd.team_id = $1)
                OR ($2::text IS NOT NULL AND pd.user_id = $2)
            )
        ORDER BY LOWER(pd.display_name), po.display_order, po.number_value, LOWER(po.string_value)
        "#,
        team_id,
        user_id,
        include_system
    )
    .fetch_all(pool)
    .await?;

    let mut property_map: HashMap<Uuid, PropertyDefinitionWithOptions> = HashMap::new();

    for row in rows {
        let owner = models_properties::PropertyOwner::from_optional_ids(
            row.team_id,
            row.user_id.clone(),
            row.is_system,
        );

        let property_def = PropertyDefinition {
            id: row.id,
            owner,
            display_name: row.display_name.clone(),
            data_type: row.data_type,
            is_multi_select: row.is_multi_select,
            specific_entity_type: row.specific_entity_type.flatten(),
            created_at: row.created_at,
            updated_at: row.updated_at,
            is_system: row.is_system,
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
            && (row.data_type == DataType::SelectNumber
                || row.data_type == DataType::SelectString
                || row.data_type == DataType::Tag)
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
                color: row.option_color,
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

/// Creates a new property definition, atomically creating any select options
/// alongside it.
#[tracing::instrument(skip(pool, options))]
pub async fn create_property_definition(
    pool: &Pool<Postgres>,
    owner: PropertyDefinitionOwner<'_>,
    display_name: &str,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityType>,
    options: Vec<PropertyOption>,
) -> anyhow::Result<PropertyDefinition> {
    let (team_id, user_id) = owner.into_ids();
    let user_id: Option<&str> = user_id.map(|u| u.as_ref());

    let id = macro_uuid::generate_uuid_v7();

    let mut tx = pool.begin().await?;

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
    .fetch_one(&mut *tx)
    .await?;

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
        create_property_option_tx(
            &mut tx,
            db_property_def.id,
            option.display_order,
            option.value,
            option.color,
        )
        .await?;
    }

    tx.commit().await?;

    Ok(db_property_def.into())
}

/// Inserts a property option within an existing transaction.
pub(super) async fn create_property_option_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    property_definition_id: Uuid,
    display_order: i32,
    value: PropertyOptionValue,
    color: Option<String>,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();
    let (number_value, string_value) = value.to_db_values();

    sqlx::query!(
        r#"
        INSERT INTO property_options (
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
        id,
        property_definition_id,
        display_order,
        number_value,
        string_value,
        color
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Display name used for the auto-provisioned tag definition.
pub const TAG_DEFINITION_DISPLAY_NAME: &str = "Tags";

/// Gets the single tag definition owned by the given owner, if it exists.
#[tracing::instrument(skip(pool), err)]
pub async fn get_tag_definition(
    pool: &Pool<Postgres>,
    owner: PropertyDefinitionOwner<'_>,
) -> anyhow::Result<Option<PropertyDefinition>> {
    let (team_id, user_id) = owner.into_ids();
    let user_id: Option<&str> = user_id.map(|u| u.as_ref());

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
    .fetch_optional(pool)
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

/// Returns the owner's tag definition, creating it on first use.
///
/// Tag definitions are TAG-typed, multi-select, and unique per owner (enforced by a partial
/// unique index). A lost create race re-fetches the definition the winner just created.
#[tracing::instrument(skip(pool), err)]
pub async fn get_or_create_tag_definition(
    pool: &Pool<Postgres>,
    owner: PropertyDefinitionOwner<'_>,
) -> anyhow::Result<PropertyDefinition> {
    if let Some(existing) = get_tag_definition(pool, owner).await? {
        return Ok(existing);
    }

    match create_property_definition(
        pool,
        owner,
        TAG_DEFINITION_DISPLAY_NAME,
        DataType::Tag,
        true,
        None,
        Vec::new(),
    )
    .await
    {
        Ok(def) => Ok(def),
        Err(create_err) => match get_tag_definition(pool, owner).await? {
            Some(existing) => Ok(existing),
            None => Err(create_err),
        },
    }
}

/// Deletes a property definition and all associated data (cascades).
#[tracing::instrument(skip(pool))]
pub async fn delete_property_definition(
    pool: &Pool<Postgres>,
    property_definition_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "DELETE FROM property_definitions WHERE id = $1",
        property_definition_id
    )
    .execute(pool)
    .await?;

    Ok(())
}
