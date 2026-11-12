use document_sub_type::DocumentSubType;
use model_owner::Owner;
use sqlx::{Pool, Postgres};

use model::document::{DocumentMetadata, FileType};

/// Gets the document ids for a user.
/// TODO: needs to be cached
#[tracing::instrument(skip(db))]
pub async fn get_user_document_ids(
    db: &Pool<Postgres>,
    user_id: &str,
    file_types: Option<Vec<FileType>>,
) -> anyhow::Result<Vec<String>> {
    let document_ids = if let Some(file_types) = file_types {
        sqlx::query!(
            r#"
                SELECT
                    d.id as document_id
                FROM
                    "Document" d
                WHERE
                    d.owner = $1 AND d."deletedAt" IS NULL AND d."fileType" = ANY($2)
            "#,
            user_id,
            &file_types
                .iter()
                .map(|f| f.to_string())
                .collect::<Vec<String>>()
        )
        .map(|row| row.document_id)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query!(
            r#"
            SELECT
                d.id as document_id
            FROM
                "Document" d
            WHERE
                d.owner = $1 AND d."deletedAt" IS NULL
        "#,
            user_id
        )
        .map(|row| row.document_id)
        .fetch_all(db)
        .await?
    };

    Ok(document_ids)
}

#[tracing::instrument(skip(db))]
pub async fn get_user_documents(
    db: &Pool<Postgres>,
    user_id: &str,
    limit: i64,
    offset: i64,
    file_type: Option<String>,
) -> anyhow::Result<(Vec<DocumentMetadata>, i64)> {
    let total = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "Document" d
        WHERE d.owner = $1 AND d."deletedAt" IS NULL
            AND ($2::text IS NULL OR d."fileType" = $2)
        "#,
        user_id,
        file_type.as_deref(),
    )
    .fetch_one(db)
    .await?;

    if total == 0 {
        return Ok((vec![], 0));
    }

    let documents = sqlx::query!(
        r#"
        SELECT
            d.id as document_id,
            d.owner as owner,
            d.name as document_name,
            COALESCE(db.id, di.id) as "document_version_id!",
            d."branchedFromId" as branched_from_id,
            d."branchedFromVersionId" as branched_from_version_id,
            d."documentFamilyId" as document_family_id,
            d."fileType" as file_type,
            d.appearance,
            d."createdAt"::timestamptz as created_at,
            d."updatedAt"::timestamptz as updated_at,
            db.bom_parts as "document_bom",
            di.modification_data as "modification_data",
            d."projectId" as "project_id",
            p.name as "project_name?",
            di.sha as "sha?",
            dt.sub_type as "sub_type?: DocumentSubType",
            d."deletedAt"::timestamptz as deleted_at
        FROM
            "Document" d
        LEFT JOIN document_sub_type dt ON dt.document_id = d.id
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
                i.id,
                i."documentId",
                i."sha",
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
                i."updatedAt" DESC
            LIMIT 1
        ) di ON d."fileType" IS DISTINCT FROM 'docx'
        LEFT JOIN LATERAL (
            SELECT
                p.name
            FROM "Project" p
            WHERE p.id = d."projectId"
        ) p ON d."projectId" IS NOT NULL
        WHERE
        d.owner = $1 AND d."deletedAt" IS NULL
            AND ($4::text IS NULL OR d."fileType" = $4)
        ORDER BY d."updatedAt" DESC
        LIMIT $2 OFFSET $3
        "#,
        user_id,
        limit,
        offset,
        file_type.as_deref(),
    )
    .try_map(|row| {
        Ok(DocumentMetadata {
            appearance: row
                .appearance
                .map(serde_json::from_value)
                .transpose()
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            document_id: row.document_id,
            document_version_id: row.document_version_id,
            owner: Owner::from_principal_str(&row.owner)
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            document_name: row.document_name,
            file_type: row.file_type,
            sha: row.sha,
            project_id: row.project_id,
            project_name: row.project_name,
            branched_from_id: row.branched_from_id,
            branched_from_version_id: row.branched_from_version_id,
            document_family_id: row.document_family_id,
            document_bom: row.document_bom,
            modification_data: row.modification_data,
            created_at: row.created_at,
            updated_at: row.updated_at,
            sub_type: row.sub_type,
            deleted_at: row.deleted_at,
        })
    })
    .fetch_all(db)
    .await?;

    Ok((documents, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_get_user_documents(pool: Pool<Postgres>) {
        let appearance = model_entity::EntityAppearance {
            icon: Some(model_entity::AppearanceIcon::Emoji {
                value: "📋".into()
            }),
            color: None,
        };
        sqlx::query!(
            r#"UPDATE "Document" SET appearance = $1 WHERE id = 'document-seven'"#,
            sqlx::types::Json(&appearance) as _,
        )
        .execute(&pool)
        .await
        .unwrap();
        let documents = get_user_documents(&pool, &"macro|user@user.com", 3, 0, None)
            .await
            .unwrap();

        assert_eq!(documents.0.len(), 3);
        assert_eq!(documents.1, 7);
        assert_eq!(documents.0[0].appearance.as_ref(), Some(&appearance));

        let document_ids: Vec<(String, i64)> = documents
            .0
            .iter()
            .map(|doc| (doc.document_id.clone(), doc.document_version_id))
            .collect();

        assert_eq!(
            document_ids,
            vec![
                ("document-seven".to_string(), 1),
                ("document-six".to_string(), 6),
                ("document-five".to_string(), 5),
            ]
        );

        let documents = get_user_documents(&pool, &"macro|user@user.com", 3, 3, None)
            .await
            .unwrap();

        assert_eq!(documents.0.len(), 3);
        assert_eq!(documents.1, 7);
        let document_ids: Vec<(String, i64)> = documents
            .0
            .iter()
            .map(|doc| (doc.document_id.clone(), doc.document_version_id))
            .collect();

        assert_eq!(
            document_ids,
            vec![
                ("document-four".to_string(), 4),
                ("document-three".to_string(), 3),
                ("document-two".to_string(), 2),
            ]
        );
        let documents = get_user_documents(&pool, &"macro|user@user.com", 3, 6, None)
            .await
            .unwrap();

        assert_eq!(documents.0.len(), 1);
        assert_eq!(documents.1, 7);
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_get_user_documents_with_filters(pool: Pool<Postgres>) {
        let documents = get_user_documents(
            &pool,
            &"macro|user@user.com",
            3,
            0,
            Some("docx".to_string()),
        )
        .await
        .unwrap();

        assert_eq!(documents.0.len(), 1);
        assert_eq!(documents.1, 1);

        let documents =
            get_user_documents(&pool, &"macro|user@user.com", 3, 0, Some("pdf".to_string()))
                .await
                .unwrap();

        assert_eq!(documents.0.len(), 3);
        assert_eq!(documents.1, 5);

        let document_ids: Vec<(String, i64)> = documents
            .0
            .iter()
            .map(|doc| (doc.document_id.clone(), doc.document_version_id))
            .collect();

        assert_eq!(
            document_ids,
            vec![
                ("document-six".to_string(), 6),
                ("document-five".to_string(), 5),
                ("document-four".to_string(), 4),
            ]
        );
    }
}
