use model::document::DocumentMetadata;

use super::SearchExtractorMessage;

/// Gets the document metadata (latest version of the document) from the database if it exists
#[tracing::instrument(skip(db, search_extractor_message), fields(document_id=search_extractor_message.document_id))]
pub async fn get_document_info(
    db: &sqlx::Pool<sqlx::Postgres>,
    search_extractor_message: &SearchExtractorMessage,
) -> anyhow::Result<Option<DocumentMetadata>> {
    let document_basic = match macro_db_client::document::get_basic_document(
        db,
        search_extractor_message.document_id.as_str(),
    )
    .await
    {
        Ok(document) => document,
        Err(e) => match e {
            sqlx::Error::RowNotFound => {
                return Ok(None);
            }
            _ => {
                anyhow::bail!("unable to get basic document")
            }
        },
    };

    if document_basic.deleted_at.is_some() {
        return Ok(None);
    }

    match macro_db_client::document::get_document(db, search_extractor_message.document_id.as_str())
        .await
    {
        Ok(document) => Ok(Some(document)),
        Err(e) => {
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one")
            {
                tracing::debug!("document not found");
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}
