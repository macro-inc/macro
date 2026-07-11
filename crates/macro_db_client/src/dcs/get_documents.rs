use anyhow::Result;
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

#[derive(Debug, Clone)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
}

#[tracing::instrument(skip(db))]
pub async fn get_documents_count(db: &Pool<Postgres>) -> Result<i64> {
    sqlx::query!(
        r#"
            SELECT COUNT(*) as "count"
            FROM "Document" d
            WHERE d."deletedAt" IS NULL
        "#,
    )
    .map(|row| row.count.unwrap_or(0))
    .fetch_one(db)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "error getting document count");
        err.into()
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_paginated_documents(
    db: &Pool<Postgres>,
    limit: i64,
    prev_response: Option<PaginatedResponse<DocWithOwnerAndType>>,
) -> Result<PaginatedResponse<DocWithOwnerAndType>> {
    let (total_count, offset) = match prev_response {
        Some(prev_response) => (prev_response.total_count, prev_response.offset),
        None => (get_documents_count(db).await? as i64, 0_i64),
    };

    if total_count == 0 {
        return Ok(PaginatedResponse {
            items: vec![],
            total_count: 0,
            has_more: false,
            offset: 0,
        });
    }

    let documents: Vec<DocWithOwnerAndType> = sqlx::query!(
        r#"
        SELECT
            d.id,
            d."owner",
            d.name,
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
            d."deletedAt" IS NULL
            AND d."fileType" IS NOT NULL
        ORDER BY d."createdAt" DESC
        LIMIT $1 OFFSET $2
        "#,
        limit,
        offset as i64,
    )
    .map(|row| DocWithOwnerAndType {
        id: row.id,
        name: row.name,
        owner: row.owner,
        file_type: row.file_type,
        document_version_id: row.document_version_id,
    })
    .fetch_all(db)
    .await?;

    let new_offset = offset + documents.len() as i64;

    Ok(PaginatedResponse {
        items: documents,
        total_count,
        has_more: new_offset < total_count,
        offset: new_offset,
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_documents_without_text_count(db: &Pool<Postgres>) -> Result<i64> {
    sqlx::query!(
        r#"
            SELECT COUNT(*) as "count"
            FROM "Document" d
            LEFT JOIN "DocumentText" dt ON d.id = dt."documentId"
            WHERE d."deletedAt" IS NULL
            AND dt."documentId" IS NULL
        "#,
    )
    .map(|row| row.count.unwrap_or(0))
    .fetch_one(db)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "error getting document without text count");
        err.into()
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_paginated_documents_without_text(
    db: &Pool<Postgres>,
    limit: i64,
    prev_response: Option<PaginatedResponse<DocWithOwnerAndType>>,
) -> Result<PaginatedResponse<DocWithOwnerAndType>> {
    let (total_count, offset) = match prev_response {
        Some(prev_response) => (prev_response.total_count, prev_response.offset),
        None => (get_documents_without_text_count(db).await? as i64, 0_i64),
    };

    if total_count == 0 {
        return Ok(PaginatedResponse {
            items: vec![],
            total_count: 0,
            has_more: false,
            offset: 0,
        });
    }

    let documents: Vec<DocWithOwnerAndType> = sqlx::query!(
        r#"
        SELECT
            d.id,
            d.name,
            d.owner,
            d."fileType" as "file_type!",
            di.id as "document_version_id?"
        FROM
            "Document" d
        LEFT JOIN "DocumentText" dt ON d.id = dt."documentId"
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
            d."deletedAt" IS NULL
            AND dt."documentId" IS NULL
            AND d."fileType" IS NOT NULL
        ORDER BY d."createdAt" DESC
        LIMIT $1 OFFSET $2
        "#,
        limit,
        offset as i64,
    )
    .map(|row| DocWithOwnerAndType {
        id: row.id,
        name: row.name,
        owner: row.owner,
        file_type: row.file_type,
        document_version_id: row.document_version_id,
    })
    .fetch_all(db)
    .await?;

    let new_offset = offset + documents.len() as i64;

    Ok(PaginatedResponse {
        items: documents,
        total_count,
        has_more: new_offset < total_count,
        offset: new_offset,
    })
}
