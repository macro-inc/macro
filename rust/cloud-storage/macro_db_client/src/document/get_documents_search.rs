use sqlx::{Pool, Postgres};

use model::document::BackfillSearchDocumentInformation;

/// Used to get all documents in a paginated format
/// This will get the latest version of the document for non-pdf documents
/// For pdf documents, this will get the oldest version of the document
#[tracing::instrument(skip(db))]
pub async fn get_documents_for_search(
    db: &Pool<Postgres>,
    limit: i64,
    offset: i64,
    file_types: &Option<Vec<String>>,
) -> anyhow::Result<Vec<BackfillSearchDocumentInformation>> {
    let result = if let Some(file_types) = file_types {
        sqlx::query!(
            r#"
            SELECT
                d.id as document_id,
                d.owner as owner,
                d."fileType" as "file_type!",
                COALESCE(db.id, di.id, dipdf.id) as "document_version_id!"
            FROM
                "Document" d
            LEFT JOIN LATERAL (
                SELECT
                    b.id
                FROM
                    "DocumentBom" b
                WHERE
                    b."documentId" = d.id
                ORDER BY
                    b."createdAt" DESC
                LIMIT 1
            ) db ON d."fileType" = 'docx'
            LEFT JOIN LATERAL (
                SELECT
                    i.id
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."updatedAt" ASC
                LIMIT 1
            ) dipdf ON d."fileType" = 'pdf'
            LEFT JOIN LATERAL (
                SELECT
                    i.id
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."createdAt" DESC
                LIMIT 1
            ) di ON d."fileType" IS DISTINCT FROM 'docx' AND d."fileType" IS DISTINCT FROM 'pdf'
            WHERE
                d."deletedAt" IS NULL AND d."fileType" = ANY($3)
            ORDER BY d."updatedAt" DESC
            LIMIT $1 OFFSET $2
    "#,
            limit,
            offset,
            file_types
        )
        .map(|row| BackfillSearchDocumentInformation {
            document_id: row.document_id,
            document_version_id: row.document_version_id,
            owner: row.owner,
            file_type: row.file_type.as_str().try_into().unwrap(),
        })
        .fetch_all(db)
        .await?
    } else {
        sqlx::query!(
            r#"
            SELECT
                d.id as document_id,
                d.owner as owner,
                d."fileType" as "file_type!",
                COALESCE(db.id, di.id, dipdf.id) as "document_version_id!"
            FROM
                "Document" d
            LEFT JOIN LATERAL (
                SELECT
                    b.id
                FROM
                    "DocumentBom" b
                WHERE
                    b."documentId" = d.id
                ORDER BY
                    b."createdAt" DESC
                LIMIT 1
            ) db ON d."fileType" = 'docx'
            LEFT JOIN LATERAL (
                SELECT
                    i.id
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."updatedAt" ASC
                LIMIT 1
            ) dipdf ON d."fileType" = 'pdf'
            LEFT JOIN LATERAL (
                SELECT
                    i.id
                FROM
                    "DocumentInstance" i
                WHERE
                    i."documentId" = d.id
                ORDER BY
                    i."createdAt" DESC
                LIMIT 1
            ) di ON d."fileType" IS DISTINCT FROM 'docx' AND d."fileType" IS DISTINCT FROM 'pdf'
            WHERE
                d."deletedAt" IS NULL AND d."fileType" IS NOT NULL
            ORDER BY d."updatedAt" DESC
            LIMIT $1 OFFSET $2
    "#,
            limit,
            offset
        )
        .map(|row| BackfillSearchDocumentInformation {
            document_id: row.document_id,
            document_version_id: row.document_version_id,
            owner: row.owner,
            file_type: row.file_type.as_str().try_into().unwrap(),
        })
        .fetch_all(db)
        .await?
    };

    Ok(result)
}
