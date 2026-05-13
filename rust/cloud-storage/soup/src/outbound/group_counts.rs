//! Lightweight group count queries for accurate totals.

use std::collections::HashMap;

use models_grouping::{
    GroupByField, date_bucket_sql_key, date_bucket_to_range, is_valid_date_bucket_key,
};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Error type for group count operations.
#[derive(Debug, Error)]
pub enum GroupCountError {
    /// Invalid bucket key provided
    #[error("Invalid bucket key: {0}")]
    InvalidBucketKey(String),
    /// Database error
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Validate that a bucket key is valid for the given field.
pub fn is_valid_bucket_key(key: &str, field: &GroupByField) -> bool {
    match field {
        GroupByField::Date => is_valid_date_bucket_key(key),
        GroupByField::EntityType => matches!(
            key,
            "document" | "chat" | "project" | "email_thread" | "channel" | "call"
        ),
        GroupByField::Project => true,
        GroupByField::Property { .. } => true,
    }
}

/// Shared access control CTE prefix for count queries.
/// Must match the logic in `expanded/dynamic.rs`.
fn access_control_cte() -> &'static str {
    r#"
    WITH user_source_ids AS (
        SELECT cp.channel_id::text as source_id
        FROM comms_channel_participants cp
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
        UNION ALL
        SELECT t.team_id::text FROM team_user t WHERE t.user_id = $1
        UNION ALL
        SELECT $1
    ),
    UserAccessibleItems AS (
        SELECT DISTINCT
            ea.entity_id::text as item_id,
            ea.entity_type as item_type
        FROM entity_access ea
        WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
    )
    "#
}

/// Fetch per-group counts for soup items (documents, chats, projects).
#[tracing::instrument(skip(pool), err)]
pub async fn grouped_soup_counts(
    pool: &PgPool,
    user_id: &str,
    field: &GroupByField,
) -> Result<HashMap<String, u32>, GroupCountError> {
    match field {
        GroupByField::Date => get_date_bucket_counts(pool, user_id).await,
        GroupByField::EntityType => get_entity_type_counts(pool, user_id).await,
        GroupByField::Project => get_project_counts(pool, user_id).await,
        GroupByField::Property {
            property_definition_id,
            entity_type,
        } => {
            get_property_counts(
                pool,
                user_id,
                *property_definition_id,
                entity_type.as_deref(),
            )
            .await
        }
    }
}

/// Fetch count for a single group bucket (used in "load more" mode).
#[tracing::instrument(skip(pool), err)]
pub async fn grouped_soup_bucket_count(
    pool: &PgPool,
    user_id: &str,
    field: &GroupByField,
    bucket_key: &str,
) -> Result<u32, GroupCountError> {
    if !is_valid_bucket_key(bucket_key, field) {
        return Err(GroupCountError::InvalidBucketKey(bucket_key.to_string()));
    }

    match field {
        GroupByField::Date => get_date_bucket_single_count(pool, user_id, bucket_key).await,
        GroupByField::EntityType => get_entity_type_single_count(pool, user_id, bucket_key).await,
        GroupByField::Project => get_project_single_count(pool, user_id, bucket_key).await,
        GroupByField::Property {
            property_definition_id,
            entity_type,
        } => {
            get_property_single_count(
                pool,
                user_id,
                *property_definition_id,
                entity_type.as_deref(),
                bucket_key,
            )
            .await
        }
    }
}

async fn get_date_bucket_counts(
    pool: &PgPool,
    user_id: &str,
) -> Result<HashMap<String, u32>, GroupCountError> {
    let bucket_expr = date_bucket_sql_key(r#""updatedAt""#);
    let access_cte = access_control_cte();

    let sql = format!(
        r#"
        {access_cte},
        counts AS (
            SELECT ({bucket_expr}) as bucket, COUNT(*) as cnt
            FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            WHERE d."deletedAt" IS NULL
            GROUP BY 1

            UNION ALL

            SELECT ({bucket_expr}) as bucket, COUNT(*) as cnt
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            WHERE c."deletedAt" IS NULL
            GROUP BY 1

            UNION ALL

            SELECT ({bucket_expr}) as bucket, COUNT(*) as cnt
            FROM "Project" p
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = p.id::text AND uai.item_type = 'project'
            WHERE p."deletedAt" IS NULL
            GROUP BY 1
        )
        SELECT bucket, SUM(cnt)::bigint as total
        FROM counts
        GROUP BY bucket
        "#
    );

    let rows: Vec<(String, i64)> = sqlx::query_as(&sql).bind(user_id).fetch_all(pool).await?;

    Ok(rows.into_iter().map(|(k, v)| (k, v as u32)).collect())
}

async fn get_date_bucket_single_count(
    pool: &PgPool,
    user_id: &str,
    bucket_key: &str,
) -> Result<u32, GroupCountError> {
    let (start, end) = date_bucket_to_range(bucket_key)
        .ok_or_else(|| GroupCountError::InvalidBucketKey(bucket_key.to_string()))?;
    let access_cte = access_control_cte();

    let sql = format!(
        r#"
        {access_cte},
        counts AS (
            SELECT COUNT(*) as cnt FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            WHERE d."deletedAt" IS NULL
              AND d."updatedAt" >= $2 AND d."updatedAt" < $3
            UNION ALL
            SELECT COUNT(*) FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            WHERE c."deletedAt" IS NULL
              AND c."updatedAt" >= $2 AND c."updatedAt" < $3
            UNION ALL
            SELECT COUNT(*) FROM "Project" p
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = p.id::text AND uai.item_type = 'project'
            WHERE p."deletedAt" IS NULL
              AND p."updatedAt" >= $2 AND p."updatedAt" < $3
        )
        SELECT COALESCE(SUM(cnt), 0)::bigint FROM counts
        "#
    );

    let row: (i64,) = sqlx::query_as(&sql)
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_one(pool)
        .await?;

    Ok(row.0 as u32)
}

async fn get_entity_type_counts(
    pool: &PgPool,
    user_id: &str,
) -> Result<HashMap<String, u32>, GroupCountError> {
    let access_cte = access_control_cte();

    let sql = format!(
        r#"
        {access_cte}
        SELECT entity_type, cnt FROM (
            SELECT 'document' as entity_type, COUNT(*)::bigint as cnt
            FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            WHERE d."deletedAt" IS NULL
            UNION ALL
            SELECT 'chat', COUNT(*)
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            WHERE c."deletedAt" IS NULL
            UNION ALL
            SELECT 'project', COUNT(*)
            FROM "Project" p
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = p.id::text AND uai.item_type = 'project'
            WHERE p."deletedAt" IS NULL
        ) sub
        WHERE cnt > 0
        "#
    );

    let rows: Vec<(String, i64)> = sqlx::query_as(&sql).bind(user_id).fetch_all(pool).await?;

    Ok(rows.into_iter().map(|(k, v)| (k, v as u32)).collect())
}

async fn get_entity_type_single_count(
    pool: &PgPool,
    user_id: &str,
    entity_type: &str,
) -> Result<u32, GroupCountError> {
    let access_cte = access_control_cte();

    let (table, alias, type_str) = match entity_type {
        "document" => (r#""Document""#, "d", "document"),
        "chat" => (r#""Chat""#, "c", "chat"),
        "project" => (r#""Project""#, "p", "project"),
        _ => return Ok(0),
    };

    let sql = format!(
        r#"
        {access_cte}
        SELECT COUNT(*)::bigint
        FROM {table} {alias}
        INNER JOIN UserAccessibleItems uai
            ON uai.item_id = {alias}.id::text AND uai.item_type = '{type_str}'
        WHERE {alias}."deletedAt" IS NULL
        "#
    );

    let row: (i64,) = sqlx::query_as(&sql).bind(user_id).fetch_one(pool).await?;

    Ok(row.0 as u32)
}

async fn get_project_counts(
    pool: &PgPool,
    user_id: &str,
) -> Result<HashMap<String, u32>, GroupCountError> {
    let access_cte = access_control_cte();

    let sql = format!(
        r#"
        {access_cte},
        counts AS (
            SELECT COALESCE("projectId"::text, '') as project_id, COUNT(*) as cnt
            FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            WHERE d."deletedAt" IS NULL
            GROUP BY "projectId"
            UNION ALL
            SELECT COALESCE("projectId"::text, ''), COUNT(*)
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            WHERE c."deletedAt" IS NULL
            GROUP BY "projectId"
        )
        SELECT project_id as project, SUM(cnt)::bigint as total
        FROM counts
        GROUP BY project_id
        "#
    );

    let rows: Vec<(String, i64)> = sqlx::query_as(&sql).bind(user_id).fetch_all(pool).await?;

    Ok(rows.into_iter().map(|(k, v)| (k, v as u32)).collect())
}

async fn get_project_single_count(
    pool: &PgPool,
    user_id: &str,
    project_key: &str,
) -> Result<u32, GroupCountError> {
    let access_cte = access_control_cte();

    let project_filter = if project_key.is_empty() {
        r#""projectId" IS NULL"#
    } else {
        r#""projectId" = $2::uuid"#
    };

    let sql = format!(
        r#"
        {access_cte},
        counts AS (
            SELECT COUNT(*) as cnt
            FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            WHERE d."deletedAt" IS NULL AND {project_filter}
            UNION ALL
            SELECT COUNT(*)
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            WHERE c."deletedAt" IS NULL AND {project_filter}
        )
        SELECT COALESCE(SUM(cnt), 0)::bigint FROM counts
        "#
    );

    let row: (i64,) = if project_key.is_empty() {
        sqlx::query_as(&sql).bind(user_id).fetch_one(pool).await?
    } else {
        sqlx::query_as(&sql)
            .bind(user_id)
            .bind(project_key)
            .fetch_one(pool)
            .await?
    };

    Ok(row.0 as u32)
}

async fn get_property_counts(
    pool: &PgPool,
    user_id: &str,
    property_definition_id: Uuid,
    entity_type: Option<&str>,
) -> Result<HashMap<String, u32>, GroupCountError> {
    let access_cte = access_control_cte();

    let sql = format!(
        r#"
        {access_cte},
        all_counts AS (
            SELECT
                COALESCE(ep.values->'value'->>0, '') as prop_value,
                COUNT(*)::bigint as cnt
            FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            LEFT JOIN entity_properties ep
                ON ep.entity_id = d.id::text
                AND ep.property_definition_id = $2
                AND ($3::text IS NULL OR ep.entity_type = $3)
            WHERE d."deletedAt" IS NULL
            GROUP BY prop_value

            UNION ALL

            SELECT
                COALESCE(ep.values->'value'->>0, '') as prop_value,
                COUNT(*)::bigint as cnt
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            LEFT JOIN entity_properties ep
                ON ep.entity_id = c.id::text
                AND ep.property_definition_id = $2
                AND ($3::text IS NULL OR ep.entity_type = $3)
            WHERE c."deletedAt" IS NULL
            GROUP BY prop_value

            UNION ALL

            SELECT
                COALESCE(ep.values->'value'->>0, '') as prop_value,
                COUNT(*)::bigint as cnt
            FROM "Project" p
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = p.id::text AND uai.item_type = 'project'
            LEFT JOIN entity_properties ep
                ON ep.entity_id = p.id::text
                AND ep.property_definition_id = $2
                AND ($3::text IS NULL OR ep.entity_type = $3)
            WHERE p."deletedAt" IS NULL
            GROUP BY prop_value
        )
        SELECT prop_value, SUM(cnt)::bigint as total
        FROM all_counts
        GROUP BY prop_value
        "#
    );

    let rows: Vec<(String, i64)> = sqlx::query_as(&sql)
        .bind(user_id)
        .bind(property_definition_id)
        .bind(entity_type)
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(|(k, v)| (k, v as u32)).collect())
}

async fn get_property_single_count(
    pool: &PgPool,
    user_id: &str,
    property_definition_id: Uuid,
    entity_type: Option<&str>,
    property_value: &str,
) -> Result<u32, GroupCountError> {
    let access_cte = access_control_cte();

    let value_filter = if property_value.is_empty() {
        "ep.values IS NULL"
    } else {
        "ep.values->'value'->>0 = $4"
    };

    let sql = format!(
        r#"
        {access_cte},
        counts AS (
            SELECT COUNT(*) as cnt
            FROM "Document" d
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = d.id::text AND uai.item_type = 'document'
            LEFT JOIN entity_properties ep
                ON ep.entity_id = d.id::text
                AND ep.property_definition_id = $2
                AND ($3::text IS NULL OR ep.entity_type = $3)
            WHERE d."deletedAt" IS NULL AND {value_filter}

            UNION ALL

            SELECT COUNT(*)
            FROM "Chat" c
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = c.id::text AND uai.item_type = 'chat'
            LEFT JOIN entity_properties ep
                ON ep.entity_id = c.id::text
                AND ep.property_definition_id = $2
                AND ($3::text IS NULL OR ep.entity_type = $3)
            WHERE c."deletedAt" IS NULL AND {value_filter}

            UNION ALL

            SELECT COUNT(*)
            FROM "Project" p
            INNER JOIN UserAccessibleItems uai
                ON uai.item_id = p.id::text AND uai.item_type = 'project'
            LEFT JOIN entity_properties ep
                ON ep.entity_id = p.id::text
                AND ep.property_definition_id = $2
                AND ($3::text IS NULL OR ep.entity_type = $3)
            WHERE p."deletedAt" IS NULL AND {value_filter}
        )
        SELECT COALESCE(SUM(cnt), 0)::bigint FROM counts
        "#
    );

    let row: (i64,) = if property_value.is_empty() {
        sqlx::query_as(&sql)
            .bind(user_id)
            .bind(property_definition_id)
            .bind(entity_type)
            .fetch_one(pool)
            .await?
    } else {
        sqlx::query_as(&sql)
            .bind(user_id)
            .bind(property_definition_id)
            .bind(entity_type)
            .bind(property_value)
            .fetch_one(pool)
            .await?
    };

    Ok(row.0 as u32)
}
