//! Queries that move a personal label into a team tag set.
//!
//! Both operations rewrite the same two things atomically: which definition the
//! label hangs off, and which option id every entity carrying it references.
//! Promotion keeps the option id (so nothing else has to change), while a merge
//! retargets entities onto an option the team already has.

use models_properties::EntityType;
use models_properties::db;
use models_properties::service::property_option::PropertyOption;
use sqlx::{Pool, Postgres, Transaction};
use uuid::Uuid;

use super::entity_property_queries::EntityPropertyMutationRow;
use crate::domain::model::{TagPromotionOutcome, TagRemapOutcome};

/// One entity holding the label being remapped.
struct AffectedEntity {
    entity_id: String,
    entity_type: EntityType,
}

/// Move a personal tag option into a team tag definition, keeping its id.
///
/// The target definition row is locked first so concurrent promotions into the
/// same team serialize: the second caller reads the first caller's label and
/// gets a [`TagPromotionOutcome::Conflict`] rather than adding a duplicate.
#[tracing::instrument(skip(pool), err)]
pub async fn promote_tag_option(
    pool: &Pool<Postgres>,
    option_id: Uuid,
    source_definition_id: Uuid,
    target_definition_id: Uuid,
) -> anyhow::Result<TagPromotionOutcome> {
    let mut tx = pool.begin().await?;

    lock_definition(&mut tx, target_definition_id).await?;

    let Some(source) = load_option(&mut tx, option_id, source_definition_id).await? else {
        anyhow::bail!("tag option {option_id} is not owned by definition {source_definition_id}");
    };
    let source_value = match &source.value {
        models_properties::service::property_option::PropertyOptionValue::String(value) => {
            value.clone()
        }
        models_properties::service::property_option::PropertyOptionValue::Number(_) => {
            anyhow::bail!("tag option {option_id} does not hold a string value")
        }
    };

    if let Some(conflict) =
        find_option_by_name(&mut tx, target_definition_id, &source_value).await?
    {
        tx.rollback().await?;
        return Ok(TagPromotionOutcome::Conflict(conflict));
    }

    // Append the label to the end of the team's set rather than carrying the
    // personal display order over, which would collide with an existing team
    // label at the same position.
    let promoted = sqlx::query_as!(
        db::PropertyOption,
        r#"
        UPDATE property_options
        SET property_definition_id = $2,
            display_order = COALESCE(
                (
                    SELECT MAX(display_order) + 1
                    FROM property_options
                    WHERE property_definition_id = $2
                ),
                0
            ),
            updated_at = NOW()
        WHERE id = $1
        RETURNING
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        "#,
        option_id,
        target_definition_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    let mutations = remap_entity_values(
        &mut tx,
        source_definition_id,
        option_id,
        target_definition_id,
        option_id,
    )
    .await?;

    tx.commit().await?;

    Ok(TagPromotionOutcome::Promoted(TagRemapOutcome {
        option: promoted.try_into()?,
        mutations,
    }))
}

/// Retag every entity carrying a personal label with an existing team label,
/// then delete the personal option.
///
/// Returns `None` when the target option does not belong to the target
/// definition, so the caller can report a missing option rather than remapping
/// entities onto a label from another set.
#[tracing::instrument(skip(pool), err)]
pub async fn merge_tag_option(
    pool: &Pool<Postgres>,
    source_option_id: Uuid,
    source_definition_id: Uuid,
    target_option_id: Uuid,
    target_definition_id: Uuid,
) -> anyhow::Result<Option<TagRemapOutcome>> {
    let mut tx = pool.begin().await?;

    lock_definition(&mut tx, target_definition_id).await?;

    let Some(target) = load_option(&mut tx, target_option_id, target_definition_id).await? else {
        tx.rollback().await?;
        return Ok(None);
    };
    if load_option(&mut tx, source_option_id, source_definition_id)
        .await?
        .is_none()
    {
        anyhow::bail!(
            "tag option {source_option_id} is not owned by definition {source_definition_id}"
        );
    }

    let mutations = remap_entity_values(
        &mut tx,
        source_definition_id,
        source_option_id,
        target_definition_id,
        target_option_id,
    )
    .await?;

    sqlx::query!(
        "DELETE FROM property_options WHERE id = $1",
        source_option_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Some(TagRemapOutcome {
        option: target,
        mutations,
    }))
}

/// Take the definition-level lock that serializes writers competing for the
/// same label name in one tag set.
async fn lock_definition(
    tx: &mut Transaction<'_, Postgres>,
    definition_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query_scalar!(
        "SELECT id FROM property_definitions WHERE id = $1 FOR UPDATE",
        definition_id
    )
    .fetch_optional(&mut **tx)
    .await?;
    Ok(())
}

/// Read one option, scoped to the definition it must belong to.
async fn load_option(
    tx: &mut Transaction<'_, Postgres>,
    option_id: Uuid,
    definition_id: Uuid,
) -> anyhow::Result<Option<PropertyOption>> {
    let row = sqlx::query_as!(
        db::PropertyOption,
        r#"
        SELECT
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        FROM property_options
        WHERE id = $1 AND property_definition_id = $2
        "#,
        option_id,
        definition_id,
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(TryInto::try_into).transpose()?)
}

/// Find a label in the set whose name matches `value`, compared the way a
/// person reads label names: trimmed and case-insensitive.
async fn find_option_by_name(
    tx: &mut Transaction<'_, Postgres>,
    definition_id: Uuid,
    value: &str,
) -> anyhow::Result<Option<PropertyOption>> {
    let row = sqlx::query_as!(
        db::PropertyOption,
        r#"
        SELECT
            id,
            property_definition_id,
            display_order,
            number_value,
            string_value,
            color,
            created_at,
            updated_at
        FROM property_options
        WHERE property_definition_id = $1
          AND string_value IS NOT NULL
          AND LOWER(BTRIM(string_value)) = LOWER(BTRIM($2))
        ORDER BY display_order, id
        LIMIT 1
        "#,
        definition_id,
        value,
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(TryInto::try_into).transpose()?)
}

/// Move every entity's reference to `source_option_id` under
/// `source_definition_id` onto `target_option_id` under
/// `target_definition_id`, returning the post-write state of each target row.
///
/// The target rows are the ones search and Soup rebuild from, so only those are
/// returned; the source rows are left attached with the option stripped, which
/// is how [`super::property_option_queries::delete_property_option`] already
/// leaves a removed option.
async fn remap_entity_values(
    tx: &mut Transaction<'_, Postgres>,
    source_definition_id: Uuid,
    source_option_id: Uuid,
    target_definition_id: Uuid,
    target_option_id: Uuid,
) -> anyhow::Result<Vec<crate::domain::model::EntityPropertyMutationSnapshot>> {
    // Lock the source rows in a stable order so two remaps touching the same
    // entities can't deadlock against each other.
    let affected = sqlx::query_as!(
        AffectedEntity,
        r#"
        SELECT entity_id, entity_type as "entity_type: EntityType"
        FROM entity_properties
        WHERE property_definition_id = $1
          AND values ->> 'type' = 'SelectOption'
          AND values -> 'value' @> jsonb_build_array($2::text)
        ORDER BY entity_id, entity_type
        FOR UPDATE
        "#,
        source_definition_id,
        source_option_id.to_string(),
    )
    .fetch_all(&mut **tx)
    .await?;

    if affected.is_empty() {
        return Ok(Vec::new());
    }

    let row_ids: Vec<Uuid> = affected
        .iter()
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();
    let entity_ids: Vec<String> = affected
        .iter()
        .map(|entity| entity.entity_id.clone())
        .collect();
    let entity_types: Vec<EntityType> = affected.iter().map(|entity| entity.entity_type).collect();

    // Attach the target label, merging into whatever the entity already has for
    // the target definition instead of replacing it.
    let rows = sqlx::query_as!(
        EntityPropertyMutationRow,
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        SELECT
            source.id,
            source.entity_id,
            source.entity_type,
            $4,
            jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array($5::text))
        FROM UNNEST($1::uuid[], $2::text[], $3::property_entity_type[])
            AS source(id, entity_id, entity_type)
        ON CONFLICT (entity_id, entity_type, property_definition_id)
        DO UPDATE SET
            values = CASE
                WHEN entity_properties.values ->> 'type' = 'SelectOption'
                     AND entity_properties.values -> 'value' @> jsonb_build_array($5::text)
                    THEN entity_properties.values
                WHEN entity_properties.values ->> 'type' = 'SelectOption'
                    THEN jsonb_set(
                            entity_properties.values,
                            '{value}',
                            (entity_properties.values -> 'value') || jsonb_build_array($5::text)
                        )
                ELSE jsonb_build_object('type', 'SelectOption', 'value', jsonb_build_array($5::text))
            END,
            updated_at = NOW()
        RETURNING
            id,
            entity_id,
            entity_type as "entity_type: EntityType",
            property_definition_id,
            values as "value: serde_json::Value",
            NULL as "previous: serde_json::Value",
            created_at,
            updated_at
        "#,
        &row_ids,
        &entity_ids,
        &entity_types as &[EntityType],
        target_definition_id,
        target_option_id.to_string(),
    )
    .fetch_all(&mut **tx)
    .await?;

    // Drop the label from the set it came from. For a promotion the option id is
    // unchanged, so this is what actually moves it between the two definitions.
    sqlx::query!(
        r#"
        UPDATE entity_properties
        SET values = jsonb_set(
                values,
                '{value}',
                COALESCE(
                    (
                        SELECT jsonb_agg(elem)
                        FROM jsonb_array_elements(values -> 'value') AS elem
                        WHERE elem <> to_jsonb($2::text)
                    ),
                    '[]'::jsonb
                )
            ),
            updated_at = NOW()
        WHERE property_definition_id = $1
          AND values ->> 'type' = 'SelectOption'
          AND values -> 'value' @> jsonb_build_array($2::text)
        "#,
        source_definition_id,
        source_option_id.to_string(),
    )
    .execute(&mut **tx)
    .await?;

    rows.into_iter()
        .map(EntityPropertyMutationRow::into_snapshot)
        .collect()
}
