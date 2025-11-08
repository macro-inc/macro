use sqlx::{Pool, Postgres};

use model::document::response::GetDocumentListResult;

#[tracing::instrument(skip(db))]
pub async fn get_document_list(
    db: Pool<Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<GetDocumentListResult>> {
    let result = sqlx::query_as!(
        GetDocumentListResult,
        r#"
        SELECT
            d.id as "document_id",
            COALESCE(db.id, di.id) as "document_version_id!",
            d.name as "document_name",
            d."fileType" as "file_type",
            d."branchedFromId" as branched_from_id,
            d."branchedFromVersionId" as branched_from_version_id,
            d."documentFamilyId" as document_family_id,
            d."createdAt"::timestamptz as created_at,
            d."updatedAt"::timestamptz as updated_at
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
                i."createdAt" DESC
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
                b."createdAt" DESC
            LIMIT 1
        ) db ON d."fileType" = 'docx'
        WHERE
            d.owner = $1 AND d."deletedAt" IS NULL
    "#,
        user_id
    )
    .fetch_all(&db)
    .await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_lots_of_documents")))]
    async fn test_get_document_search(pool: Pool<Postgres>) {
        let documents = get_document_list(pool.clone(), &"macro|user@user.com")
            .await
            .unwrap();

        assert_eq!(documents.len(), 7);

        let document_ids: Vec<(String, i64)> = documents
            .iter()
            .map(|doc| (doc.document_id.clone(), doc.document_version_id))
            .collect();

        assert_eq!(
            document_ids,
            vec![
                ("document-one".to_string(), 1),
                ("document-two".to_string(), 2),
                ("document-three".to_string(), 3),
                ("document-four".to_string(), 4),
                ("document-five".to_string(), 5),
                ("document-six".to_string(), 6),
                ("document-seven".to_string(), 1)
            ]
        );
    }
}
