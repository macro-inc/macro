use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};

/// One row of the search-backfill scan: just enough to build an upsert
/// message and the keyset cursor.
pub struct ProjectSearchBackfillRow {
    pub project_id: String,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Walk non-deleted projects in `("updatedAt" ASC, id ASC)` order for the
/// search backfill. `cursor` carries the last row of the previous page so
/// the next page resumes with `WHERE ("updatedAt", id) > cursor`.
#[tracing::instrument(skip(db), err)]
pub async fn get_projects_for_search_backfill(
    db: &Pool<Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    updated_after: Option<DateTime<Utc>>,
    updated_before: Option<DateTime<Utc>>,
) -> anyhow::Result<Vec<ProjectSearchBackfillRow>> {
    let (cursor_updated_at, cursor_project_id) = cursor.unzip();

    let rows = sqlx::query_as!(
        ProjectSearchBackfillRow,
        r#"
            SELECT
                p.id as project_id,
                p."updatedAt"::timestamptz as updated_at
            FROM "Project" p
            WHERE p."deletedAt" IS NULL
                AND (
                    $2::timestamptz IS NULL
                    OR (p."updatedAt", p.id) > ($2, $3)
                )
                AND ($4::timestamptz IS NULL OR p."updatedAt" >= $4)
                AND ($5::timestamptz IS NULL OR p."updatedAt" <= $5)
            ORDER BY p."updatedAt" ASC, p.id ASC
            LIMIT $1
        "#,
        limit,
        cursor_updated_at,
        cursor_project_id.unwrap_or_default(),
        updated_after,
        updated_before,
    )
    .fetch_all(db)
    .await?;

    Ok(rows)
}

/// Gets all sub-projects of the provided project IDs
pub async fn get_sub_project_ids(
    db: &Pool<Postgres>,
    project_ids: &[String],
) -> anyhow::Result<Vec<String>> {
    let result: Vec<String> = sqlx::query!(
        r#"
            SELECT
                p.id
            FROM
                "Project" p
            WHERE
                p."parentId" = ANY($1)
        "#,
        project_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets all projects that are older than the provided date
#[tracing::instrument(skip(db))]
pub async fn get_projects_to_delete(
    db: &Pool<Postgres>,
    date: &chrono::NaiveDateTime,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
            SELECT p.id
            FROM "Project" p
            WHERE p."deletedAt" IS NOT NULL AND p."deletedAt" <= $1
        "#,
        date
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Returns a paginated list of project IDs and their owner user IDs
/// This is useful for batch operations that need to process all projects
/// with controlled memory usage
#[tracing::instrument(skip(db))]
pub async fn get_all_project_ids_with_users_paginated(
    db: &Pool<Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<(String, String)>> {
    let result = sqlx::query!(
        r#"
        SELECT
            id,
            "userId" as user_id
        FROM
            "Project"
        WHERE
            "deletedAt" IS NULL
        ORDER BY
            "createdAt" DESC
        LIMIT $1 OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| (row.id, row.user_id))
    .fetch_all(db)
    .await?;

    Ok(result)
}
