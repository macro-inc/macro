use model::document::DocumentMetadata;

use super::SearchExtractorMessage;

/// Result of looking up a document for indexing.
pub enum DocumentInfo {
    /// Active document — proceed with indexing.
    Active(Box<DocumentMetadata>),
    /// Document has been soft-deleted or no longer exists in the DB. The
    /// caller should remove any matching entry from the search index.
    Removable,
    /// Lookup hit an unexpected absence (e.g. version metadata missing). The
    /// caller should leave the search index untouched.
    Skip,
}

/// Gets the document metadata (latest version of the document) from the database.
#[tracing::instrument(skip(db, search_extractor_message), fields(document_id=search_extractor_message.document_id))]
pub async fn get_document_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<DocumentInfo> {
    let document_basic = match macro_db_client::document::get_basic_document(
        db,
        search_extractor_message.document_id.as_str(),
    )
    .await
    {
        Ok(document) => document,
        Err(sqlx::Error::RowNotFound) => return Ok(DocumentInfo::Removable),
        Err(_) => anyhow::bail!("unable to get basic document"),
    };

    if document_basic.deleted_at.is_some() {
        return Ok(DocumentInfo::Removable);
    }

    match macro_db_client::document::get_document(db, search_extractor_message.document_id.as_str())
        .await
    {
        Ok(document) => Ok(DocumentInfo::Active(Box::new(document))),
        Err(e) => {
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one")
            {
                tracing::debug!("document version not found");
                Ok(DocumentInfo::Skip)
            } else {
                Err(e)
            }
        }
    }
}
