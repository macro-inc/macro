//! Query for foreign entity access.

use sqlx::PgPool;
use uuid::Uuid;

#[cfg(feature = "explain_binary")]
use crate::domain::models::AccessGrant;

/// Check whether any stored-for source pair grants access to a foreign entity.
#[tracing::instrument(err, skip(pool, source_ids, source_auth_entities))]
pub async fn has_foreign_entity_access(
    pool: &PgPool,
    foreign_entity_id: &Uuid,
    source_ids: &[String],
    source_auth_entities: &[String],
) -> Result<bool, sqlx::Error> {
    if source_ids.is_empty()
        || source_auth_entities.is_empty()
        || source_ids.len() != source_auth_entities.len()
    {
        return Ok(false);
    }

    sqlx::query_scalar!(
        r#"
        WITH source_pairs AS (
            SELECT DISTINCT stored_for_id, stored_for_auth_entity
            FROM UNNEST($2::text[], $3::text[])
                AS source_rows(stored_for_id, stored_for_auth_entity)
        )
        SELECT EXISTS (
            SELECT 1
            FROM foreign_entity fe
            WHERE fe.id = $1
              AND EXISTS (
                SELECT 1
                FROM source_pairs s
                WHERE s.stored_for_id = fe.stored_for_id
                  AND s.stored_for_auth_entity = fe.stored_for_auth_entity
              )
        ) AS "has_access!"
        "#,
        foreign_entity_id,
        source_ids,
        source_auth_entities,
    )
    .fetch_one(pool)
    .await
}

#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids, source_auth_entities))]
pub async fn list_foreign_entity_grants(
    pool: &PgPool,
    foreign_entity_id: &Uuid,
    source_ids: &[String],
    source_auth_entities: &[String],
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    if source_ids.is_empty()
        || source_auth_entities.is_empty()
        || source_ids.len() != source_auth_entities.len()
    {
        return Ok(vec![]);
    }

    let rows = sqlx::query!(
        r#"
        WITH source_pairs AS (
            SELECT DISTINCT stored_for_id, stored_for_auth_entity
            FROM UNNEST($2::text[], $3::text[])
                AS source_rows(stored_for_id, stored_for_auth_entity)
        )
        SELECT
            fe.stored_for_id AS "stored_for_id!",
            fe.stored_for_auth_entity AS "stored_for_auth_entity!"
        FROM foreign_entity fe
        JOIN source_pairs s
          ON s.stored_for_id = fe.stored_for_id
         AND s.stored_for_auth_entity = fe.stored_for_auth_entity
        WHERE fe.id = $1
        "#,
        foreign_entity_id,
        source_ids,
        source_auth_entities,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            AccessGrant::foreign_entity_auth(&row.stored_for_auth_entity).map(
                |stored_for_auth_entity| AccessGrant::ForeignEntity {
                    stored_for_id: row.stored_for_id,
                    stored_for_auth_entity,
                },
            )
        })
        .collect())
}
