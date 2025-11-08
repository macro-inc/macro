use std::collections::HashSet;

use model::document::{DocumentPreviewData, DocumentPreviewV2, WithDocumentId};

#[tracing::instrument(skip(db))]
pub async fn batch_get_document_preview_v2(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_ids: &[String],
) -> anyhow::Result<Vec<DocumentPreviewV2>> {
    let found_documents: Vec<DocumentPreviewData> = sqlx::query_as!(
        DocumentPreviewData,
        r#"
            SELECT
                d.id as document_id,
                d.name as document_name,
                d."fileType" as file_type,
                d.owner as owner,
                d."updatedAt"::timestamptz as "updated_at"
            FROM "Document" d
            WHERE
                d."id" = ANY($1)
        "#,
        document_ids,
    )
    .fetch_all(db)
    .await?;

    let found_docs: HashSet<String> = found_documents
        .iter()
        .map(|row| row.document_id.clone())
        .collect();

    let result: Vec<DocumentPreviewV2> = document_ids
        .iter()
        .map(|id| {
            if !found_docs.contains(id) {
                DocumentPreviewV2::DoesNotExist(WithDocumentId {
                    document_id: id.clone(),
                })
            } else {
                let row = found_documents
                    .iter()
                    .find(|r| r.document_id == *id)
                    .unwrap();

                DocumentPreviewV2::Found(row.clone())
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_preview")))]
    async fn test_batch_get_document_preview_v2(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_ids = vec![
            "document-one".to_string(),
            "document-two".to_string(),
            "non-existent-doc".to_string(),
        ];

        let results = batch_get_document_preview_v2(&pool, &document_ids).await?;

        assert_eq!(results.len(), 3);

        match &results[0] {
            DocumentPreviewV2::Found(data) => {
                assert_eq!(data.document_id, "document-one");
                assert_eq!(data.document_name, "test_document_name");
                assert_eq!(data.file_type, Some("pdf".to_string()));
            }
            _ => panic!("Expected Access variant for document-one"),
        }

        match &results[1] {
            DocumentPreviewV2::Found(data) => {
                assert_eq!(data.document_id, "document-two");
                assert_eq!(data.document_name, "test_document_name");
                assert_eq!(data.file_type, Some("pdf".to_string()));
            }
            _ => panic!("Expected Found variant for document-two"),
        }

        match &results[2] {
            DocumentPreviewV2::DoesNotExist(data) => {
                assert_eq!(data.document_id, "non-existent-doc");
            }
            _ => panic!("Expected DoesNotExist variant for non-existent-doc"),
        }

        Ok(())
    }
}
