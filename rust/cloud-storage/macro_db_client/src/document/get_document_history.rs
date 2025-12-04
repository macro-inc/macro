use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct DocumentHistoryInfo {
    /// The id of the document
    pub item_id: String,
    /// The owner of the document
    pub owner: String,
    /// The file type of the document
    pub file_type: Option<String>,
    /// The file name of the document
    pub file_name: String,
    /// Created at
    pub created_at: DateTime<Utc>,
    /// Updated at
    pub updated_at: DateTime<Utc>,
    /// Viewed at
    pub viewed_at: Option<DateTime<Utc>>,
    /// The project id of the document
    pub project_id: Option<String>,
    /// Deleted at
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Gets document history information including when a user last viewed each document
/// Returns only entries that exist in the database
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
            c."owner" as "owner",
            c."fileType" as "file_type",
            c."name" as "file_name",
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

    let document_history_map: HashMap<String, DocumentHistoryInfo> = results
        .into_iter()
        .map(|row| {
            let info = DocumentHistoryInfo {
                item_id: row.item_id.clone(),
                owner: row.owner,
                file_type: row.file_type,
                file_name: row.file_name,
                created_at: DateTime::<Utc>::from_naive_utc_and_offset(row.created_at, Utc),
                updated_at: DateTime::<Utc>::from_naive_utc_and_offset(row.updated_at, Utc),
                viewed_at: row
                    .viewed_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
                project_id: row.project_id,
                deleted_at: row
                    .deleted_at
                    .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc)),
            };
            (row.item_id, info)
        })
        .collect();

    Ok(document_history_map)
}
