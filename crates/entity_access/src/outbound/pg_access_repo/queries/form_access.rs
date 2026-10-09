//! Query for form access level.

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::collections::BTreeMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The highest access level `source_ids` hold on a form: its `entity_access`
/// grants, plus View for anyone while the form's audience is public and it is
/// not trashed. With no source ids (an anonymous caller) only the public arm
/// can answer, and it never answers more than View.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_form_access(
    pool: &PgPool,
    form_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
        AND entity_type = 'form'
        AND source_id = ANY($2)

        UNION ALL

        SELECT 'view'
        FROM forms
        WHERE id = $1
        AND audience = 'public'
        AND trashed_at IS NULL
        "#,
        form_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    super::database_access::highest_access_level(&all_level_strings)
}

/// The highest access level `source_ids` hold through grants on every live
/// form they reach, ordered by form id. The public arm is deliberately absent:
/// a public audience makes a form answerable by link, not listed to everyone.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn list_form_access(
    pool: &PgPool,
    source_ids: &SourceIds,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT ea.entity_id, ea.access_level AS "access_level: AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY($1)
        AND f.trashed_at IS NULL
        "#,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let mut highest: BTreeMap<Uuid, AccessLevel> = BTreeMap::new();
    for row in rows {
        highest
            .entry(row.entity_id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(highest.into_iter().collect())
}

/// List the grants behind a form's access: its `entity_access` rows, and the
/// public audience when it applies.
#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn explain_form_access(
    pool: &PgPool,
    form_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants = list_entity_access_grants(pool, form_id, EntityType::Form, source_ids).await?;
    let is_public = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM forms
            WHERE id = $1
            AND audience = 'public'
            AND trashed_at IS NULL
        ) AS "is_public!"
        "#,
        form_id,
    )
    .fetch_one(pool)
    .await?;
    if is_public {
        grants.push(AccessGrant::PublicForm);
    }
    Ok(grants)
}
