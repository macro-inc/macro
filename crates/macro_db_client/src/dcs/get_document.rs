use sqlx::{Pool, Postgres};

#[derive(Debug, Clone)]
pub struct DocWithOwnerAndType {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub file_type: String,
    // will be None for docx
    pub document_version_id: Option<i64>,
}

impl Default for DocWithOwnerAndType {
    fn default() -> Self {
        DocWithOwnerAndType {
            id: "".to_string(),
            name: "".to_string(),
            owner: "".to_string(),
            file_type: "".to_string(),
            document_version_id: None,
        }
    }
}

#[tracing::instrument(skip(db))]
pub async fn get_document(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<Option<DocWithOwnerAndType>> {
    let document: DocWithOwnerAndType = sqlx::query_as!(
        DocWithOwnerAndType,
        r#"
        SELECT
            d.id,
            d.name,
            d."owner",
            d."fileType" as "file_type!",
            di.id as "document_version_id?"
        FROM
            "Document" d
        LEFT JOIN LATERAL (
            SELECT
                i.id
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."createdAt" ASC
            LIMIT 1
        ) di ON true
        WHERE
            d."deletedAt" IS NULL AND
            d.id = $1 AND
            d."fileType" IS NOT NULL
        "#,
        document_id
    )
    .fetch_one(db)
    .await?;
    Ok(Some(document))
}
