use anyhow::Context;
use opensearch_client::OpensearchClient;
use sqs_client::search::document::{DocumentId, SearchExtractorMessage};

mod document_info;
mod raw_document;

pub async fn process_remove_message(
    opensearch_client: &OpensearchClient,
    remove_message: &DocumentId,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_document(remove_message.document_id.as_str(), None)
        .await?;

    Ok(())
}

/// Refresh the denormalized `document_name` on the parent doc after a rename.
/// The DB is the source of truth for the name, so it is fetched here rather
/// than carried on the message — this converges to the latest name even if
/// renames are processed out of order. A missing or soft-deleted document is a
/// no-op: the remove path owns deletions, and a not-yet-indexed doc will pick
/// up its name on its first full index.
pub async fn process_update_name_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    update_message: &DocumentId,
) -> anyhow::Result<()> {
    let document = match macro_db_client::document::get_basic_document(
        db,
        update_message.document_id.as_str(),
    )
    .await
    {
        Ok(document) => document,
        Err(sqlx::Error::RowNotFound) => {
            tracing::debug!(
                document_id = %update_message.document_id,
                "document not found; skipping search name update"
            );
            return Ok(());
        }
        Err(e) => return Err(e).context("unable to get basic document for search name update"),
    };

    if document.deleted_at.is_some() {
        tracing::debug!(
            document_id = %update_message.document_id,
            "document is deleted; skipping search name update"
        );
        return Ok(());
    }

    opensearch_client
        .update_document_metadata(update_message.document_id.as_str(), &document.document_name)
        .await
        .context("failed to update document name in search index")?;

    Ok(())
}

pub async fn process_extract_text_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    s3_client: &s3_client::S3,
    document_storage_bucket: &str,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<()> {
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
