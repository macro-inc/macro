use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectHistoryInfo {
    pub item_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub parent_project_id: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Gets project history information including when a user last viewed each project
/// Returns only entries that exist in the database
#[tracing::instrument(skip(db))]
pub async fn get_project_history_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    project_ids: &[String],
) -> anyhow::Result<HashMap<String, ProjectHistoryInfo>> {
    if project_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results = sqlx::query!(
        r#"
        SELECT
            p."id" as "item_id!",
            p."createdAt" as "created_at!",
            p."updatedAt" as "updated_at!",
            p."deletedAt" as "deleted_at?",
            p."parentId" as "parent_project_id?",
            uh."updatedAt" as "viewed_at?"
        FROM
            "Project" p
        LEFT JOIN
            "UserHistory" uh ON uh."itemId" = p."id"
                AND uh."userId" = $1
                AND uh."itemType" = 'project'
        WHERE
            p."id" = ANY($2)
        ORDER BY
            p."updatedAt" DESC
        "#,
        user_id,
        project_ids,
    )
    .fetch_all(db)
    .await?;

    let project_history_map: HashMap<String, ProjectHistoryInfo> = results
        .into_iter()
        .map(|row| {
            let info = ProjectHistoryInfo {
                item_id: row.item_id.clone(),
                created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
                updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
                viewed_at: row
                    .viewed_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
                parent_project_id: row.parent_project_id,
                deleted_at: row
                    .deleted_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
            };
            (row.item_id, info)
        })
        .collect();

    Ok(project_history_map)
}
