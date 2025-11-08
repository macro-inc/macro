use model::document::DocumentMetadata;

/// Gets all docx files
#[tracing::instrument(skip(db))]
pub async fn get_docx_files(
    db: &sqlx::PgPool,
    limit: i64,
    offset: i64,
) -> anyhow::Result<(Vec<DocumentMetadata>, i64)> {
    let count = sqlx::query!(
        r#"
        SELECT COUNT(*) as "count"
        FROM "Document" d
        WHERE d."fileType" = 'docx' AND d."deletedAt" IS NULL AND d.uploaded = true
        "#
    )
    .map(|row| row.count.unwrap_or(0))
    .fetch_one(db)
    .await?;

    if count == 0 {
        return Ok((vec![], 0));
    }

    let documents = sqlx::query!(
        r#"
        SELECT
            d.id as document_id,
            d.owner as owner,
            d.name as document_name,
            db.id as "document_version_id!",
            d."fileType" as "file_type?",
            d."createdAt"::timestamptz as created_at,
            d."updatedAt"::timestamptz as updated_at,
            db.bom_parts as "document_bom?",
            d."projectId" as "project_id?",
            p.name as "project_name?"
        FROM
            "Document" d
        LEFT JOIN LATERAL (
            SELECT
                b.id,
                (
                    SELECT
                        json_agg(
                            json_build_object(
                                'id', bp.id,
                                'sha', bp.sha,
                                'path', bp.path
                            )
                        )
                    FROM
                        "BomPart" bp
                    WHERE
                        bp."documentBomId" = b.id
                ) as bom_parts
            FROM
                "DocumentBom" b
            WHERE
                b."documentId" = d.id
            ORDER BY
                b."createdAt" DESC
            LIMIT 1

        ) db ON true
        LEFT JOIN LATERAL (
            SELECT
                p.name
            FROM "Project" p
            WHERE p.id = d."projectId"
        ) p ON d."projectId" IS NOT NULL
        WHERE d."fileType" = 'docx' AND d."deletedAt" IS NULL AND d.uploaded = true
        ORDER BY d."updatedAt" DESC
        LIMIT $1 OFFSET $2
    "#,
        limit,
        offset
    )
    .map(|row| DocumentMetadata {
        document_id: row.document_id,
        document_version_id: row.document_version_id,
        owner: row.owner,
        document_name: row.document_name,
        file_type: row.file_type,
        created_at: row.created_at,
        updated_at: row.updated_at,
        document_bom: row.document_bom,
        project_id: row.project_id,
        project_name: row.project_name,
        sha: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        modification_data: None,
    })
    .fetch_all(db)
    .await?;

    Ok((documents, count))
}
