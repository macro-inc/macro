use anyhow::Context;
use model::document::FileTypeExt;
use models_opensearch::SearchEntityType;
use opensearch_client::OpensearchClient;
use sqs_client::search::document::{DocumentId, SearchExtractorMessage};

mod document_info;
mod raw_document;

pub async fn process_remove_message(
    opensearch_client: &OpensearchClient,
    remove_message: &DocumentId,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_document(remove_message.document_id.as_str())
        .await?;

    opensearch_client
        .delete_entity_name(
            remove_message.document_id.as_str(),
            &SearchEntityType::Documents,
        )
        .await?;

    Ok(())
}

pub async fn process_extract_text_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<()> {
    if search_extractor_message.file_type.is_image() {
        tracing::trace!("image file, ignoring");
        return Ok(());
    }

    raw_document::update_search_with_raw_document(
        opensearch_client,
        db,
        s3_client,
        document_storage_bucket,
        search_extractor_message,
    )
    .await
    .context(format!(
        "{} {:?} unable to update search with raw document",
        search_extractor_message.document_id, search_extractor_message.file_type
    ))?;

    Ok(())
}

pub async fn process_extract_sync_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    lexical_client: &lexical_client::LexicalClient,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<()> {
    raw_document::update_search_with_sync_document(
        opensearch_client,
        db,
        s3_client,
        document_storage_bucket,
        lexical_client,
        search_extractor_message,
    )
    .await
    .context(format!(
        "{} {:?} unable to update search with sync document",
        search_extractor_message.document_id, search_extractor_message.file_type
    ))?;

    Ok(())
}

pub async fn process_update_metadata_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<()> {
    let document_info = match macro_db_client::document::get_basic_document(db, document_id).await {
        Ok(document_info) => document_info,
        Err(e) => match e {
            sqlx::Error::RowNotFound => {
                return Ok(());
            }
            _ => {
                anyhow::bail!("unable to get document info")
            }
        },
    };

    if document_info.deleted_at.is_some() {
        return Ok(());
    }

    opensearch_client
        .update_document_metadata(document_id, document_info.document_name.as_str())
        .await?;

    Ok(())
}
