use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("document_preview")))]
async fn test_batch_get_document_preview_v2(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let document_ids = vec![
        "document-one".to_string(),
        "document-two".to_string(),
        "non-existent-doc".to_string(),
        "document-trashed".to_string(),
    ];

    let results = batch_get_document_preview_v2(&pool, &document_ids, None).await?;

    assert_eq!(results.len(), 4);

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

    match &results[3] {
        DocumentPreviewV2::DoesNotExist(data) => {
            assert_eq!(data.document_id, "document-trashed");
        }
        _ => panic!("Expected DoesNotExist variant for document-trashed"),
    }

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("document_preview")))]
async fn test_trashed_document_previews_only_for_its_owner(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = MacroUserIdStr::try_from(
        sqlx::query_scalar!(r#"SELECT owner FROM "Document" WHERE id = 'document-trashed'"#)
            .fetch_one(&pool)
            .await?,
    )?;
    let other = MacroUserIdStr::try_from(
        sqlx::query_scalar!(r#"SELECT owner FROM "Document" WHERE id = 'document-two'"#)
            .fetch_one(&pool)
            .await?,
    )?;
    let document_ids = vec!["document-trashed".to_string()];

    let for_owner = batch_get_document_preview_v2(&pool, &document_ids, Some(&owner)).await?;
    match &for_owner[0] {
        DocumentPreviewV2::Found(data) => {
            assert_eq!(data.document_name, "trashed_document_name");
        }
        _ => panic!("Expected the owner to see their trashed document"),
    }

    let for_other = batch_get_document_preview_v2(&pool, &document_ids, Some(&other)).await?;
    assert!(matches!(
        &for_other[0],
        DocumentPreviewV2::DoesNotExist(data) if data.document_id == "document-trashed"
    ));

    Ok(())
}
