use sqlx::{Executor, Pool, Postgres};

#[derive(Debug, Clone)]
pub struct DocumentText {
    pub document_id: String,
    pub content: String,
    pub token_count: i64,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ExtractionStatusEnum {
    Complete,
    Empty,
    Insufficient,
    Incomplete,
}

pub fn status_of_extracted_text_length(length: usize) -> ExtractionStatusEnum {
    // cleaned_text is empty
    if length == 0 {
        return ExtractionStatusEnum::Empty;
    }

    // cleaned_text has insufficient content (< 1000 chars)
    // Note: INSUFFICIENT_DOCUMENT_TEXT constant needs to be defined or passed in
    const INSUFFICIENT_DOCUMENT_TEXT: usize = 1000;
    if length < INSUFFICIENT_DOCUMENT_TEXT {
        return ExtractionStatusEnum::Insufficient;
    }

    ExtractionStatusEnum::Complete
}

pub fn status_of_extracted_text(text_content: &str) -> ExtractionStatusEnum {
    let cleaned_text_length = text_content
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .len();

    status_of_extracted_text_length(cleaned_text_length)
}

#[tracing::instrument(skip(db))]
pub async fn get_pdf_docx_document_text(
    db: Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<DocumentText, sqlx::Error> {
    let document_text = sqlx::query_as!(
        DocumentText,
        r#"
        SELECT
            d."documentId" as "document_id",
            d.content as "content",
            d."tokenCount" as "token_count"
        FROM
            "DocumentText" d
        WHERE
            d."documentId" = $1
        "#,
        document_id,
    )
    .fetch_one(&db)
    .await?;

    Ok(document_text)
}

pub struct WithDocumentId {
    pub document_id: String,
}

#[tracing::instrument(skip(db))]
pub async fn get_document_texts_with_no_tokens(
    db: Pool<Postgres>,
) -> anyhow::Result<Vec<String>, sqlx::Error> {
    let document_texts = sqlx::query_as!(
        WithDocumentId,
        r#"
        SELECT
            d."documentId" as "document_id"
        FROM
            "DocumentText" d
        WHERE
            d."tokenCount" = 0
        "#,
    )
    .fetch_all(&db)
    .await?;

    Ok(document_texts
        .into_iter()
        .map(|row| row.document_id)
        .collect())
}

#[tracing::instrument(skip(db))]
pub async fn document_text_extraction_status(
    db: Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<ExtractionStatusEnum> {
    let document_text_length = sqlx::query!(
        r#"
        SELECT
            LENGTH(REGEXP_REPLACE(d."content", '\s', '', 'g')) AS content_length
        FROM
            "DocumentText" d
        WHERE
            d."documentId" = $1
        "#,
        document_id,
    )
    .fetch_optional(&db)
    .await?;

    if let Some(record) = document_text_length {
        if let Some(content_length) = record.content_length {
            return Ok(status_of_extracted_text_length(content_length as usize));
        } else {
            return Ok(ExtractionStatusEnum::Empty);
        }
    } else {
        Ok(ExtractionStatusEnum::Incomplete)
    }
}

#[tracing::instrument(skip(db))]
pub async fn batch_document_text_extraction_status(
    db: Pool<Postgres>,
    document_ids: &Vec<String>,
) -> anyhow::Result<Vec<(String, ExtractionStatusEnum)>> {
    if document_ids.is_empty() {
        return Ok(vec![]);
    }
    let existing_documents = sqlx::query!(
        r#"
        SELECT DISTINCT
            d."documentId",
            LENGTH(REGEXP_REPLACE(d."content", '\s', '', 'g')) AS content_length
        FROM
            "DocumentText" d
        WHERE
            d."documentId" = ANY($1)
        "#,
        document_ids as _,
    )
    .fetch_all(&db)
    .await?;

    let existing_documents_map: std::collections::HashMap<String, usize> = existing_documents
        .into_iter()
        .map(|row| (row.documentId, row.content_length.unwrap() as usize))
        .collect();

    let res = document_ids
        .clone()
        .into_iter()
        .map(|document_id| {
            if let Some(length) = existing_documents_map.get(&document_id) {
                (document_id, status_of_extracted_text_length(*length))
            } else {
                (document_id, ExtractionStatusEnum::Incomplete)
            }
        })
        .collect();

    Ok(res)
}

#[tracing::instrument(err, skip_all)]
pub async fn get_pdf_docx_token_count<'e, E>(db: E, document_id: &str) -> Result<i64, anyhow::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"SELECT
            "tokenCount" as token_count
            FROM
            "DocumentText"
            WHERE
            "documentId" = $1
        "#,
        document_id
    )
    .fetch_one(db)
    .await
    .map_err(anyhow::Error::from)
    .map(|record| record.token_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_document_text")))]
    async fn test_get_document_text(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_text = get_pdf_docx_document_text(pool.clone(), "document-one").await?;
        assert_eq!(document_text.content, "This is a test document".to_string());
        assert_eq!(document_text.token_count, 0);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_document_text")))]
    async fn test_document_text_extraction_status_incomplete(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let extraction_status =
            document_text_extraction_status(pool.clone(), "document-incomplete").await?;
        assert_eq!(extraction_status, ExtractionStatusEnum::Incomplete);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_document_text")))]
    async fn test_document_text_extraction_status_empty(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let extraction_status =
            document_text_extraction_status(pool.clone(), "document-empty").await?;
        assert_eq!(extraction_status, ExtractionStatusEnum::Empty);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_document_text")))]
    async fn test_document_text_extraction_status_insufficient(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let extraction_status =
            document_text_extraction_status(pool.clone(), "document-insufficient").await?;
        assert_eq!(extraction_status, ExtractionStatusEnum::Insufficient);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_document_text")))]
    async fn test_document_text_extraction_status_complete(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let extraction_status =
            document_text_extraction_status(pool.clone(), "document-complete").await?;
        assert_eq!(extraction_status, ExtractionStatusEnum::Complete);
        Ok(())
    }
}
