//! Property values follow a merged record to the one that stays, inside the
//! merging domain's transaction: the record's own values, and the references
//! other entities hold to it.
//!
//! Database cells are not touched here: they belong to the database that
//! holds them and move through its own write path.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use models_properties::EntityType;
use sqlx::PgConnection;
use uuid::Uuid;

/// Who can see a definition's values on a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueScope {
    /// A system or team property.
    Team,
    /// A user's own property.
    Personal,
}

/// One of a merged record's own values, read under its writers' locks.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeEntityValue {
    /// The `entity_properties` row.
    pub id: Uuid,
    /// The record holding it.
    pub entity_id: String,
    /// The property definition.
    pub property_definition_id: Uuid,
    /// The definition's name.
    pub property_name: String,
    /// Who can see it.
    pub scope: ValueScope,
    /// The stored value, `None` for a property attached without one.
    pub values: Option<serde_json::Value>,
    /// When the row was created.
    pub created_at: DateTime<Utc>,
    /// When it was last written.
    pub updated_at: DateTime<Utc>,
}

/// A row a merge wrote, for publication.
#[derive(Debug, Clone, PartialEq)]
pub struct WrittenEntityProperty {
    /// The `entity_properties` row.
    pub id: Uuid,
    /// The entity holding it.
    pub entity_id: String,
    /// Its type.
    pub entity_type: EntityType,
    /// The property definition.
    pub property_definition_id: Uuid,
    /// When it was written.
    pub updated_at: DateTime<Utc>,
}

/// What a merge did to the records' own values.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MergedEntityValues {
    /// Values that moved to the record that stays, as they were.
    pub moved: Vec<MergeEntityValue>,
    /// The merged records' other values, deleted, as they were.
    pub deleted: Vec<MergeEntityValue>,
    /// Rows written, for publication.
    pub written: Vec<WrittenEntityProperty>,
    /// Whether a merged record holds a value `locked` did not, attached
    /// after it was read; the merge must not go ahead without it.
    pub unreviewed: bool,
}

/// A reference another entity holds to a merged record, as it was.
#[derive(Debug, Clone, PartialEq)]
pub struct RetargetedReference {
    /// The `entity_properties` row.
    pub id: Uuid,
    /// The entity holding the reference.
    pub entity_id: String,
    /// Its type.
    pub entity_type: EntityType,
    /// The property definition.
    pub property_definition_id: Uuid,
    /// The stored value before the merge.
    pub previous: serde_json::Value,
    /// The stored value after it.
    pub values: serde_json::Value,
    /// When the merge wrote it.
    pub updated_at: DateTime<Utc>,
}

/// Lock and read the own values of `entity_ids`, taking each row's writer
/// lock in key order before the rows, as single-value writers do, and the
/// lock of each property `survivor` may take from another of them, so a
/// first assignment can't race the move.
#[tracing::instrument(name = "properties.merge.lock_values", skip_all, fields(%entity_type, entities = entity_ids.len(), values = tracing::field::Empty), err)]
pub async fn lock_entity_values_in(
    conn: &mut PgConnection,
    entity_type: EntityType,
    entity_ids: &[String],
    survivor: &str,
) -> Result<Vec<MergeEntityValue>, sqlx::Error> {
    let keys = sqlx::query!(
        r#"SELECT entity_id, property_definition_id FROM entity_properties
           WHERE entity_type = $1 AND entity_id = ANY($2)
           ORDER BY entity_id, property_definition_id"#,
        entity_type as EntityType,
        entity_ids,
    )
    .fetch_all(&mut *conn)
    .await?;
    let keys: Vec<String> = keys
        .into_iter()
        .flat_map(|key| {
            [
                format!(
                    "entity_property:{entity_type}:{}:{}",
                    key.entity_id, key.property_definition_id
                ),
                format!(
                    "entity_property:{entity_type}:{survivor}:{}",
                    key.property_definition_id
                ),
            ]
        })
        .collect();
    lock_keys(conn, &keys).await?;

    let rows = sqlx::query!(
        r#"SELECT ep.id, ep.entity_id, ep.property_definition_id, pd.display_name,
                  pd.user_id IS NOT NULL AS "personal!", ep.values, ep.created_at, ep.updated_at
           FROM entity_properties ep
           JOIN property_definitions pd ON pd.id = ep.property_definition_id
           WHERE ep.entity_type = $1 AND ep.entity_id = ANY($2)
           ORDER BY ep.id
           FOR UPDATE OF ep"#,
        entity_type as EntityType,
        entity_ids,
    )
    .fetch_all(&mut *conn)
    .await?;
    tracing::Span::current().record("values", rows.len());
    Ok(rows
        .into_iter()
        .map(|row| MergeEntityValue {
            id: row.id,
            entity_id: row.entity_id,
            property_definition_id: row.property_definition_id,
            property_name: row.display_name,
            scope: if row.personal {
                ValueScope::Personal
            } else {
                ValueScope::Team
            },
            values: row.values,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect())
}

/// Read the own values of `entity_ids` without locking them, for a merge's
/// review.
pub async fn read_entity_values_in(
    conn: &mut PgConnection,
    entity_type: EntityType,
    entity_ids: &[String],
) -> Result<Vec<MergeEntityValue>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT ep.id, ep.entity_id, ep.property_definition_id, pd.display_name,
                  pd.user_id IS NOT NULL AS "personal!", ep.values, ep.created_at, ep.updated_at
           FROM entity_properties ep
           JOIN property_definitions pd ON pd.id = ep.property_definition_id
           WHERE ep.entity_type = $1 AND ep.entity_id = ANY($2)
           ORDER BY ep.id"#,
        entity_type as EntityType,
        entity_ids,
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| MergeEntityValue {
            id: row.id,
            entity_id: row.entity_id,
            property_definition_id: row.property_definition_id,
            property_name: row.display_name,
            scope: if row.personal {
                ValueScope::Personal
            } else {
                ValueScope::Team
            },
            values: row.values,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect())
}

/// Give `survivor` the values in `moves` (rows of merged records, by id) and
/// delete every other own value of `sources`. The values must have been read
/// with [`lock_entity_values_in`] in the same transaction, and the survivor
/// must hold no value for a moved row's property.
#[tracing::instrument(name = "properties.merge.values", skip_all, fields(%entity_type, moves = moves.len(), sources = sources.len()), err)]
pub async fn merge_entity_values_in(
    conn: &mut PgConnection,
    entity_type: EntityType,
    survivor: &str,
    sources: &[String],
    locked: &[MergeEntityValue],
    moves: &[Uuid],
) -> Result<MergedEntityValues, sqlx::Error> {
    // Only what was read under its writer locks: a value attached since has
    // no lock here, and deleting it would drop it unrecorded.
    let reviewed: Vec<Uuid> = locked.iter().map(|value| value.id).collect();
    // A moved value takes the place of the survivor's own row for that
    // property, which the plan found empty, so that row goes first.
    let moved_definitions: Vec<Uuid> = locked
        .iter()
        .filter(|value| moves.contains(&value.id))
        .map(|value| value.property_definition_id)
        .collect();
    let replaced_ids = sqlx::query_scalar!(
        r#"DELETE FROM entity_properties
           WHERE entity_type = $1 AND entity_id = $2 AND property_definition_id = ANY($3)
             AND id = ANY($4)
           RETURNING id"#,
        entity_type as EntityType,
        survivor,
        &moved_definitions,
        &reviewed,
    )
    .fetch_all(&mut *conn)
    .await?;
    let written = sqlx::query!(
        r#"UPDATE entity_properties SET entity_id = $1, updated_at = NOW()
           WHERE id = ANY($2) AND entity_type = $3 AND entity_id = ANY($4)
           RETURNING id, property_definition_id, updated_at"#,
        survivor,
        moves,
        entity_type as EntityType,
        sources,
    )
    .fetch_all(&mut *conn)
    .await?;
    let deleted_ids = sqlx::query_scalar!(
        r#"DELETE FROM entity_properties
           WHERE entity_type = $1 AND entity_id = ANY($2) AND id = ANY($3)
           RETURNING id"#,
        entity_type as EntityType,
        sources,
        &reviewed,
    )
    .fetch_all(&mut *conn)
    .await?;
    let unreviewed = values_remain_in(&mut *conn, entity_type, sources).await?;

    let mut merged = MergedEntityValues {
        unreviewed,
        ..MergedEntityValues::default()
    };
    for value in locked {
        if moves.contains(&value.id) {
            merged.moved.push(value.clone());
        } else if deleted_ids.contains(&value.id) || replaced_ids.contains(&value.id) {
            merged.deleted.push(value.clone());
        }
    }
    merged.written = written
        .into_iter()
        .map(|row| WrittenEntityProperty {
            id: row.id,
            entity_id: survivor.to_owned(),
            entity_type,
            property_definition_id: row.property_definition_id,
            updated_at: row.updated_at,
        })
        .collect();
    Ok(merged)
}

/// Whether any of `entity_ids` still holds a value. A merge asks after moving
/// and deleting what it read, and again as its last statement: one attached
/// since has no writer lock the merge holds, so the merge refuses instead.
/// Only a value committed between that last check and the merge's own commit
/// is left on the merged id, as values of a deleted company are today.
pub async fn values_remain_in(
    conn: &mut PgConnection,
    entity_type: EntityType,
    entity_ids: &[String],
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (
               SELECT 1 FROM entity_properties WHERE entity_type = $1 AND entity_id = ANY($2)
           ) AS "unreviewed!""#,
        entity_type as EntityType,
        entity_ids,
    )
    .fetch_one(conn)
    .await
}

/// The rows outside databases whose entity references name one of
/// `sources`, found through the reference indexes; for a preview's count.
#[tracing::instrument(name = "properties.merge.references", skip_all, fields(%referenced, sources = sources.len()), err)]
pub async fn referencing_rows_in(
    conn: &mut PgConnection,
    referenced: EntityType,
    sources: &[String],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let (system, type_tag) = reference_property(referenced);
    // Each arm repeats its index's predicate literally and probes it once per
    // source, so the cost follows the references, not the table.
    sqlx::query_scalar!(
        r#"SELECT DISTINCT ep.id AS "id!"
           FROM UNNEST($1::text[]) AS source(id)
           CROSS JOIN LATERAL (
               SELECT ep.id FROM entity_properties ep
               WHERE ep.property_definition_id = '00000001-0000-0000-0000-00000000000c'
                 AND $2::uuid = '00000001-0000-0000-0000-00000000000c'
                 AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', source.id))
                 AND ep.entity_type <> 'DATABASE_ROW'
               UNION ALL
               SELECT ep.id FROM entity_properties ep
               WHERE ep.property_definition_id = '00000001-0000-0000-0000-000000000013'
                 AND $2::uuid = '00000001-0000-0000-0000-000000000013'
                 AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', source.id))
                 AND ep.entity_type <> 'DATABASE_ROW'
               UNION ALL
               SELECT ep.id FROM entity_properties ep
               WHERE ep.entity_type <> 'DATABASE_ROW'
                 AND ep.property_definition_id <> '00000001-0000-0000-0000-00000000000c'
                 AND ep.property_definition_id <> '00000001-0000-0000-0000-000000000013'
                 AND (ep.values->'value' @> '[{"entity_type": "COMPANY"}]'
                      OR ep.values->'value' @> '[{"entity_type": "CONTACT"}]')
                 AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_type', $3::text, 'entity_id', source.id))
           ) ep
           ORDER BY 1"#,
        sources,
        system,
        type_tag,
    )
    .fetch_all(conn)
    .await
}

/// Point every reference to one of `sources` outside databases at
/// `survivor`, listing it once in each value, in its first place.
#[tracing::instrument(name = "properties.merge.retarget", skip_all, fields(%referenced, sources = sources.len(), rows = tracing::field::Empty), err)]
pub async fn retarget_references_in(
    conn: &mut PgConnection,
    referenced: EntityType,
    sources: &[String],
    survivor: &str,
) -> Result<Vec<RetargetedReference>, sqlx::Error> {
    let ids = referencing_rows_in(conn, referenced, sources).await?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Only existing rows change, so their row locks serialize with every
    // writer, which waits for them and then reads what the merge wrote. A
    // writer lock per row would hold one lock-table slot per reference.

    let (_, type_tag) = reference_property(referenced);
    let rows = sqlx::query!(
        r#"WITH old AS MATERIALIZED (
               SELECT id, values FROM entity_properties
               WHERE id = ANY($1) AND jsonb_typeof(values->'value') = 'array'
               ORDER BY id
               FOR UPDATE
           ), updated AS (
               UPDATE entity_properties ep
               SET values = jsonb_set(ep.values, '{value}', (
                       SELECT COALESCE(jsonb_agg(element ORDER BY first_seen), '[]'::jsonb)
                       FROM (
                           SELECT CASE
                                      WHEN reference->>'entity_type' = $2 AND reference->>'entity_id' = ANY($3)
                                      THEN jsonb_set(reference, '{entity_id}', to_jsonb($4::text))
                                      ELSE reference
                                  END AS element,
                                  MIN(position) AS first_seen
                           FROM jsonb_array_elements(old.values->'value') WITH ORDINALITY AS r(reference, position)
                           GROUP BY 1
                       ) elements
                   )),
                   updated_at = NOW()
               FROM old WHERE ep.id = old.id
               RETURNING ep.id, ep.entity_id, ep.entity_type, ep.property_definition_id, ep.values, ep.updated_at
           )
           SELECT updated.id, updated.entity_id, updated.entity_type AS "entity_type: EntityType",
                  updated.property_definition_id, old.values AS "previous!", updated.values AS "values!",
                  updated.updated_at
           FROM updated JOIN old ON old.id = updated.id
           ORDER BY updated.id"#,
        &ids,
        type_tag,
        sources,
        survivor,
    )
    .fetch_all(&mut *conn)
    .await?;
    tracing::Span::current().record("rows", rows.len());
    Ok(rows
        .into_iter()
        .map(|row| RetargetedReference {
            id: row.id,
            entity_id: row.entity_id,
            entity_type: row.entity_type,
            property_definition_id: row.property_definition_id,
            previous: row.previous,
            values: row.values,
            updated_at: row.updated_at,
        })
        .collect())
}

/// The system property that links records of this type, and the tag its
/// references carry.
fn reference_property(referenced: EntityType) -> (Uuid, &'static str) {
    match referenced {
        EntityType::Contact => (
            Uuid::from_u128(0x00000001_0000_0000_0000_000000000013),
            "CONTACT",
        ),
        _ => (
            Uuid::from_u128(0x00000001_0000_0000_0000_00000000000c),
            "COMPANY",
        ),
    }
}

/// Take the writer locks of `keys`, sorted, in one statement. Merges are the
/// only writers that hold more than one, so any fixed order keeps them from
/// deadlocking one another.
async fn lock_keys(conn: &mut PgConnection, keys: &[String]) -> Result<(), sqlx::Error> {
    let mut keys = keys.to_vec();
    keys.sort();
    keys.dedup();
    sqlx::query!(
        r#"SELECT count(*) AS "locked!" FROM (
               SELECT pg_advisory_xact_lock(hashtextextended(key, 0))
               FROM (SELECT key FROM UNNEST($1::text[]) WITH ORDINALITY AS k(key, position)
                     ORDER BY position) ordered
           ) locked"#,
        &keys,
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}
