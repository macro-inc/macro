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

#[derive(Debug, Clone)]
pub enum DocumentHistoryStatus {
    Found(DocumentHistoryInfo),
    Deleted,
}

/// Gets document history information including when a user last viewed each document
/// Returns a status enum that indicates whether the document was found or is deleted
#[tracing::instrument(skip(db))]
pub async fn get_document_history_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    document_ids: &[String],
) -> anyhow::Result<HashMap<String, DocumentHistoryStatus>> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results = sqlx::query!(
        r#"
        SELECT
            c."id" as "item_id!",
            c."createdAt" as "created_at!",
            c."updatedAt" as "updated_at!",
            c."deletedAt" as "deleted_at?",
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
            let status = if row.deleted_at.is_some() {
                DocumentHistoryStatus::Deleted
            } else {
                let info = DocumentHistoryInfo {
                    item_id: row.item_id.clone(),
                    created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
                    updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
                    viewed_at: row
                        .viewed_at
                        .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
                    project_id: row.project_id,
                };
                DocumentHistoryStatus::Found(info)
            };
            (row.item_id.clone(), status)
        })
        .collect();

    Ok(document_history_map)
}
