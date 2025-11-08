use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DocumentHistoryInfo {
    pub item_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub project_id: Option<String>,
}

/// Gets document history information including when a user last viewed each document
#[tracing::instrument(skip(db))]
pub async fn get_document_history_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    document_ids: &[String],
) -> anyhow::Result<HashMap<String, DocumentHistoryInfo>> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results = sqlx::query!(
        r#"
        SELECT
            c."id" as "item_id!",
            c."createdAt" as "created_at!",
            c."updatedAt" as "updated_at!",
            uh."updatedAt" as "viewed_at?",
            c."projectId" as "project_id?"
        FROM
            "Document" c
        LEFT JOIN
            "UserHistory" uh ON uh."itemId" = c."id"
                AND uh."userId" = $1
                AND uh."itemType" = 'document'
        WHERE
            c."id" = ANY($2)
            AND c."deletedAt" IS NULL
        ORDER BY
            c."updatedAt" DESC
        "#,
        user_id,
        document_ids,
    )
    .fetch_all(db)
    .await?;

    let document_history_map = results
        .into_iter()
        .map(|row| {
            let info = DocumentHistoryInfo {
                item_id: row.item_id.clone(),
                created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
                updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
                viewed_at: row
                    .viewed_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
                project_id: row.project_id,
            };
            (row.item_id.clone(), info)
        })
        .collect();

    Ok(document_history_map)
}
