use std::str::FromStr;

use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres};

use model::document::{BackfillSearchDocumentInformation, FileType};

/// Used to get all documents in a paginated format
/// This will get the latest version of the document for non-pdf documents
/// For pdf documents, this will get the oldest version of the document
///
/// Pagination is **keyset (seek-method)**: pass `cursor` as the last row's
/// `(created_at, document_id)` pair from the previous page (or `None` for
/// the first page). Each page is an O(log n) b-tree seek + LIMIT walk
/// against the `(createdAt, id)` index, regardless of depth. The
/// orchestrator stops paging when an empty result comes back.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db))]
pub async fn get_documents_for_search(
    db: &Pool<Postgres>,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    file_types: &Option<Vec<String>>,
    sub_type: &Option<String>,
    created_after: &Option<DateTime<Utc>>,
    created_before: &Option<DateTime<Utc>>,
    only_deleted: Option<bool>,
) -> anyhow::Result<Vec<BackfillSearchDocumentInformation>> {
    let (cursor_created_at, cursor_id) = match cursor {
        Some((t, id)) => (Some(t), Some(id)),
        None => (None, None),
    };
    let result = sqlx::query!(
        r#"
        SELECT
            d.id as document_id,
            d.owner as owner,
            d."fileType" as "file_type!",
            COALESCE(db.id, di.id, dipdf.id) as "document_version_id!",
            d."createdAt"::timestamptz as "created_at"
        FROM
            "Document" d
        LEFT JOIN document_sub_type dst ON dst.document_id = d.id
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
            d."fileType" IS NOT NULL
            AND ($3::text[] IS NULL OR d."fileType" = ANY($3))
            AND ($4::text IS NULL OR dst.sub_type::text = $4)
            AND ($5::timestamptz IS NULL OR d."createdAt" >= $5)
            AND ($6::timestamptz IS NULL OR d."createdAt" < $6)
            AND (
                $7::bool IS NULL
                OR ($7 AND d."deletedAt" IS NOT NULL)
                OR (NOT $7 AND d."deletedAt" IS NULL)
            )
            AND (
                $2::timestamptz IS NULL
                OR (d."createdAt", d.id) > ($2, $8::text)
            )
        ORDER BY d."createdAt" ASC, d.id ASC
        LIMIT $1
    "#,
        limit,
        cursor_created_at as Option<DateTime<Utc>>,
        file_types.as_deref() as Option<&[String]>,
        sub_type.as_deref() as Option<&str>,
        *created_after as Option<DateTime<Utc>>,
        *created_before as Option<DateTime<Utc>>,
        only_deleted,
        cursor_id as Option<String>,
    )
    .try_map(|row| {
        Ok(BackfillSearchDocumentInformation {
            document_id: row.document_id,
            document_version_id: row.document_version_id,
            owner: row.owner,
            file_type: FileType::from_str(row.file_type.as_str()).map_err(|e| {
                sqlx::Error::ColumnDecode {
                    index: "file_type".to_string(),
                    source: e.into(),
                }
            })?,
            created_at: row.created_at,
        })
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}
