use std::collections::HashSet;

use document_sub_type::DocumentSubType;
use model::document::{
    DocumentPreviewData, DocumentPreviewDataSubType, DocumentPreviewV2, WithDocumentId,
};
use system_properties::{StatusOption, SystemPropertyKey};

/// Intermediate struct for SQL row mapping with compile-time validation.
#[derive(sqlx::FromRow)]
struct PreviewQueryResult {
    document_id: String,
    file_type: Option<String>,
    document_name: String,
    owner: String,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
    sub_type: Option<DocumentSubType>,
    is_completed: Option<bool>,
}

impl From<PreviewQueryResult> for DocumentPreviewData {
    fn from(row: PreviewQueryResult) -> Self {
        Self {
            document_id: row.document_id,
            file_type: row.file_type,
            document_name: row.document_name,
            owner: row.owner,
            updated_at: row.updated_at,
            sub_type: DocumentPreviewDataSubType::from_db(row.sub_type, row.is_completed),
        }
    }
}

#[tracing::instrument(skip(db))]
pub async fn batch_get_document_preview_v2(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_ids: &[String],
) -> anyhow::Result<Vec<DocumentPreviewV2>> {
    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let rows: Vec<PreviewQueryResult> = sqlx::query_as!(
        PreviewQueryResult,
        r#"
            SELECT
                d.id as "document_id!",
                d.name as "document_name!",
                d."fileType" as file_type,
                d.owner as "owner!",
                d."updatedAt"::timestamptz as "updated_at",
                dt.sub_type as "sub_type?: DocumentSubType",
                CASE 
                    WHEN dt.sub_type = 'task' 
                        AND ep_status.values->'value' ? $2
                    THEN true 
                    WHEN dt.sub_type = 'task'
                    THEN false
                    ELSE NULL 
                END as "is_completed"
            FROM "Document" d
            LEFT JOIN document_sub_type dt ON dt.document_id = d.id
            LEFT JOIN entity_properties ep_status 
                ON dt.sub_type = 'task'
                AND ep_status.entity_id = d.id 
                AND ep_status.entity_type = 'TASK'
                AND ep_status.property_definition_id = $3
            WHERE
                d."id" = ANY($1)
        "#,
        document_ids,
        completed_option_id,
        status_property_id,
    )
    .fetch_all(db)
    .await?;

    let found_documents: Vec<DocumentPreviewData> =
        rows.into_iter().map(DocumentPreviewData::from).collect();

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
