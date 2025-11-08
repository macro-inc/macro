use sqlx::{Pool, Postgres, Transaction};

use model::document::{BomPart, DocumentBasic, DocumentMetadata};

/// Gets the documents name
#[tracing::instrument(skip(db))]
pub async fn get_document_name(db: &Pool<Postgres>, document_id: &str) -> anyhow::Result<String> {
    let document = sqlx::query!(
        r#"
        SELECT 
            d.name 
        FROM "Document" d
        WHERE d."id" = $1
    "#,
        document_id,
    )
    .map(|row| row.name)
    .fetch_one(db)
    .await?;

    Ok(document)
}

/// Gets the documents latest version id
/// Used to get location for editable documents (js, py)
#[tracing::instrument(skip(db))]
pub async fn get_latest_document_version_id(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<(i64, bool)> {
    let document = sqlx::query!(
        r#"
        SELECT 
            di.id, 
            d.uploaded
        FROM "DocumentInstance" di
        JOIN "Document" d ON di."documentId" = d.id
        WHERE di."documentId" = $1
        ORDER BY di."createdAt" DESC
        LIMIT 1
    "#,
        document_id,
    )
    .map(|row| (row.id, row.uploaded))
    .fetch_one(db)
    .await?;

    Ok(document)
}

/// Gets the documents latest bom version id
/// Used to get location for editable documents (js, py)
#[tracing::instrument(skip(db))]
pub async fn get_latest_document_bom_version_id(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<i64> {
    let document = sqlx::query!(
        r#"
        SELECT 
            db.id
        FROM "DocumentBom" db
        JOIN "Document" d ON db."documentId" = d.id
        WHERE db."documentId" = $1
        ORDER BY db."createdAt" DESC
        LIMIT 1
    "#,
        document_id,
    )
    .map(|row| row.id)
    .fetch_one(db)
    .await?;

    Ok(document)
}

/// Gets the documents oldest version id
/// Used to get location for static documents (pdf, html)
/// Also gets if the document has been uploaded
#[tracing::instrument(skip(db))]
pub async fn get_document_version_id(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<(i64, bool)> {
    let document = sqlx::query!(
        r#"
        SELECT
            COALESCE(db.id, di.id) as "id!",
            d.uploaded
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
        ) di ON d."fileType" IS DISTINCT FROM 'docx'
        LEFT JOIN LATERAL (
            SELECT
                b.id
            FROM
                "DocumentBom" b
            WHERE
                b."documentId" = d.id
            ORDER BY
                b."createdAt" ASC
            LIMIT 1
        ) db ON d."fileType" = 'docx'
        WHERE
            d.id = $1
        LIMIT 1
    "#,
        document_id,
    )
    .map(|row| (row.id, row.uploaded))
    .fetch_one(db)
    .await?;

    Ok(document)
}

pub async fn get_basic_document(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<DocumentBasic, sqlx::Error> {
    let document: DocumentBasic = sqlx::query_as!(
        DocumentBasic,
        r#"
        SELECT
            d.id as "document_id",
            d.owner,
            d.name as "document_name",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."fileType" as "file_type",
            d."projectId" as "project_id",
            d."deletedAt"::timestamptz as "deleted_at"
        FROM
            "Document" d
        WHERE
            d.id = $1
        LIMIT 1
    "#,
        document_id,
    )
    .fetch_one(db)
    .await?;

    Ok(document)
}

pub async fn get_basic_documents(
    db: &Pool<Postgres>,
    document_ids: &[String],
) -> Result<Vec<DocumentBasic>, sqlx::Error> {
    if document_ids.is_empty() {
        return Ok(Vec::new());
    }

    let documents: Vec<DocumentBasic> = sqlx::query_as!(
        DocumentBasic,
        r#"
        SELECT
            d.id as "document_id",
            d.owner,
            d.name as "document_name",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."fileType" as "file_type",
            d."projectId" as "project_id",
            d."deletedAt"::timestamptz as "deleted_at"
        FROM
            "Document" d
        WHERE
            d.id = ANY($1)
        "#,
        document_ids,
    )
    .fetch_all(db)
    .await?;

    Ok(documents)
}

/// Gets the basic document info for deleted documents
pub async fn get_deleted_document_info(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<DocumentBasic, sqlx::Error> {
    let document: DocumentBasic = sqlx::query_as!(
        DocumentBasic,
        r#"
        SELECT
            d.id as "document_id",
            d.owner,
            d.name as "document_name",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."fileType" as "file_type",
            d."projectId" as "project_id",
            d."deletedAt"::timestamptz as "deleted_at"
        FROM
            "Document" d
        WHERE
            d.id = $1
    "#,
        document_id,
    )
    .fetch_one(db)
    .await?;

    Ok(document)
}

/// Gets the metadata for a provided document id.
/// This will also get the MOST recent document instance as part of that metadata.
pub async fn get_document(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<DocumentMetadata> {
    let document_metadata: DocumentMetadata = sqlx::query_as!(
        DocumentMetadata,
        r#"
        SELECT
            d.id as "document_id",
            d.owner as "owner",
            COALESCE(db.id, di.id) as "document_version_id!",
            d.name as "document_name",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."createdAt"::timestamptz as "created_at",
            d."updatedAt"::timestamptz as "updated_at",
            d."fileType" as "file_type",
            db.bom_parts as "document_bom?",
            di.modification_data as "modification_data?",
            d."projectId" as "project_id",
            p.name as "project_name?",
            di.sha as "sha?"
        FROM
            "Document" d
        LEFT JOIN LATERAL (
            SELECT
                i.id,
                i.sha,
                i."createdAt",
                (
                    SELECT
                        imod."modificationData"
                    FROM
                        "DocumentInstanceModificationData" imod
                    WHERE
                        imod."documentInstanceId" = i.id
                ) as modification_data,
                i."updatedAt"
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            ORDER BY
                i."createdAt" DESC
            LIMIT 1
        ) di ON d."fileType" IS DISTINCT FROM 'docx'
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
        ) db ON d."fileType" = 'docx'
        LEFT JOIN LATERAL (
            SELECT
                p.name
            FROM "Project" p
            WHERE p.id = d."projectId"
        ) p ON d."projectId" IS NOT NULL
        WHERE
            d.id = $1
        LIMIT 1
    "#,
        document_id,
    )
    .fetch_one(db)
    .await?;

    Ok(document_metadata)
}

/// Gets the metadata for a provided document id and version id.
pub async fn get_document_version(
    db: &Pool<Postgres>,
    document_id: &str,
    document_version_id: i64,
) -> anyhow::Result<DocumentMetadata> {
    let document_metadata: DocumentMetadata = sqlx::query_as!(
        DocumentMetadata,
        r#"
        SELECT
            d.id as "document_id",
            d.owner as "owner",
            d.name as "document_name",
            COALESCE(di.id, db.id) as "document_version_id!",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."createdAt"::timestamptz as "created_at",
            d."updatedAt"::timestamptz as "updated_at",
            d."fileType" as "file_type",
            db.bom_parts as "document_bom?",
            di.modification_data as "modification_data?",
            d."projectId" as "project_id?",
            p.name as "project_name?",
            di.sha as "sha?"
        FROM
            "Document" d
        LEFT JOIN LATERAL (
            SELECT
                i.id,
                i.sha,
                i."createdAt",
                (
                    SELECT
                        imod."modificationData"
                    FROM
                        "DocumentInstanceModificationData" imod
                    WHERE
                        imod."documentInstanceId" = i.id
                ) as modification_data,
                i."updatedAt"
            FROM
                "DocumentInstance" i
            WHERE
                i."documentId" = d.id
            AND
                i.id = $2
        ) di ON d."fileType" IS DISTINCT FROM 'docx'
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
            AND
                b.id = $2
        ) db ON d."fileType" = 'docx'
        LEFT JOIN LATERAL (
            SELECT
                p.name
            FROM "Project" p
            WHERE p.id = d."projectId"
        ) p ON d."projectId" IS NOT NULL
        WHERE
            d.id = $1
        LIMIT 1
    "#,
        document_id,
        document_version_id,
    )
    .fetch_one(db)
    .await?;

    Ok(document_metadata)
}

#[tracing::instrument(skip(db))]
pub async fn get_document_bom(
    db: Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<Vec<BomPart>> {
    let document_bom_id = sqlx::query!(
        r#"
        SELECT b.id as "id?"
        FROM "DocumentBom" b
        WHERE b."documentId" = $1
        ORDER BY b."createdAt" DESC
        LIMIT 1
        "#,
        document_id,
    )
    .fetch_one(&db)
    .await?;

    let document_bom = sqlx::query_as!(
        BomPart,
        r#"
        SELECT
            bp.id as id,
            bp.sha as sha,
            bp.path as path
        FROM
            "BomPart" bp
        WHERE
            bp."documentBomId" = $1
        "#,
        document_bom_id.id,
    )
    .fetch_all(&db)
    .await?;

    Ok(document_bom)
}

/// Gets the documents bom parts for all of it's versions
#[tracing::instrument(skip(db))]
pub async fn get_bom_parts(db: &Pool<Postgres>, document_id: &str) -> anyhow::Result<Vec<BomPart>> {
    let bom_parts = sqlx::query_as!(
        BomPart,
        r#"
        SELECT
            bp.sha as sha,
            bp.path as path,
            bp.id as id
        FROM "BomPart" bp
        JOIN "DocumentBom" db ON bp."documentBomId" = db.id
        WHERE db."documentId" = $1;
        "#,
        document_id,
    )
    .fetch_all(db)
    .await?;

    Ok(bom_parts)
}

/// Given a list of document ids, get the bom parts for all of them
#[tracing::instrument(skip(transaction))]
pub async fn get_bom_parts_bulk_tsx(
    transaction: &mut Transaction<'_, Postgres>,
    document_ids: &[impl ToString + std::fmt::Debug],
) -> anyhow::Result<Vec<BomPart>> {
    let document_ids: Vec<String> = document_ids.iter().map(|s| s.to_string()).collect();
    let result = sqlx::query_as!(
        BomPart,
        r#"
        SELECT 
        bp.sha as sha,
        bp.path as path,
        bp.id as id
        FROM "BomPart" bp
        JOIN "DocumentBom" db ON bp."documentBomId" = db.id
        WHERE db."documentId" = ANY($1);
        "#,
        &document_ids
    )
    .fetch_all(transaction.as_mut())
    .await?;

    Ok(result)
}

pub async fn get_document_sha(
    db: Pool<Postgres>,
    document_id: &str,
    document_version_id: i64,
) -> anyhow::Result<String> {
    let document = sqlx::query!(
        r#"
        SELECT
            di.sha
        FROM
            "DocumentInstance" di
        WHERE di."documentId" = $1 AND di.id = $2
        LIMIT 1
    "#,
        document_id,
        document_version_id,
    )
    .fetch_one(&db)
    .await?;

    Ok(document.sha)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_document_owner(pool: Pool<Postgres>) {
        // document doesn't exist
        let not_found = get_basic_document(&pool, "random-uuid").await;
        assert!(not_found.is_err());
        assert_eq!(
            not_found.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row".to_string()
        );

        // document exists
        assert_eq!(
            get_basic_document(&pool, "document-one")
                .await
                .unwrap()
                .owner,
            "macro|user@user.com".to_string(),
        );
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_document(pool: Pool<Postgres>) {
        // document doesn't exist
        let no_document_found = get_document(&pool, "random-uuid").await;
        assert!(no_document_found.is_err());
        assert_eq!(
            no_document_found.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row".to_string()
        );

        // document exists
        let document_metadata = get_document(&pool, "document-one").await.unwrap();

        assert_eq!(document_metadata.document_id, "document-one".to_string());
        assert_eq!(document_metadata.document_version_id, 1,);
        assert_eq!(
            document_metadata.document_name,
            "test_document_name".to_string()
        );
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_document_null_file_type(pool: Pool<Postgres>) {
        // document exists
        let document_metadata = get_document(&pool, "document-four").await.unwrap();

        assert_eq!(document_metadata.document_id, "document-four".to_string());
        assert_eq!(document_metadata.document_version_id, 2);
        assert_eq!(document_metadata.file_type, None);
        assert_eq!(
            document_metadata.document_name,
            "test_document_name".to_string()
        );
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_document_version_null_file_type(pool: Pool<Postgres>) {
        // document exists
        let document_metadata = get_document_version(&pool, "document-four", 2)
            .await
            .unwrap();

        assert_eq!(document_metadata.document_id, "document-four".to_string());
        assert_eq!(document_metadata.document_version_id, 2);
        assert_eq!(document_metadata.file_type, None);
        assert_eq!(
            document_metadata.document_name,
            "test_document_name".to_string()
        );
        assert_eq!(document_metadata.owner, "macro|user@user.com".to_string());
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_document_sha(pool: Pool<Postgres>) {
        // document doesn't exist
        let no_document_found = get_document(&pool, "random-uuid").await;
        assert!(no_document_found.is_err());
        assert_eq!(
            no_document_found.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row".to_string()
        );

        // document exists
        let sha = get_document_sha(pool.clone(), "document-one", 1)
            .await
            .unwrap();

        assert_eq!(sha, "sha-one".to_string());
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("docx_example")))]
    async fn test_get_document_bom(pool: Pool<Postgres>) {
        let no_document_found = get_document_bom(pool.clone(), "random-uuid").await;
        assert!(no_document_found.is_err());
        assert_eq!(
            no_document_found.err().unwrap().to_string(),
            "no rows returned by a query that expected to return at least one row".to_string()
        );

        // document exists
        let bom_parts = get_document_bom(pool.clone(), "document-one")
            .await
            .unwrap();

        assert_eq!(
            bom_parts,
            vec![
                BomPart {
                    id: "b4".to_string(),
                    sha: "sha-1".to_string(),
                    path: "path".to_string()
                },
                BomPart {
                    id: "b5".to_string(),
                    sha: "sha-2".to_string(),
                    path: "path".to_string()
                },
                BomPart {
                    id: "b6".to_string(),
                    sha: "sha-4".to_string(),
                    path: "path".to_string()
                }
            ]
        );
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_versioned_document")))]
    async fn test_get_document_version_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_version = get_document_version_id(&pool, "document-one").await?;
        assert_eq!(document_version, (1, false));
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_documents")))]
    async fn test_get_document_version_id_null_file_type(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let document_version = get_document_version_id(&pool, "document-four").await?;

        assert_eq!(document_version, (2, false));
        Ok(())
    }
}
