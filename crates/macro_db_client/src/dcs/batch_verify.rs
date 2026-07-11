use anyhow::Result;
use sqlx::{Pool, Postgres};

pub struct DocumentText {
    pub document_id: String,
}

#[tracing::instrument(skip(db))]
/// Given a list of attachment ids, returns a filtered list of attachments that
/// have a corresponding [DocumentText] record and a token count > 0
pub async fn batch_verify(
    db: &Pool<Postgres>,
    attachment_ids: &Vec<String>,
) -> Result<Vec<String>> {
    let filtered_attachments = sqlx::query_as!(
        DocumentText,
        r#"
            SELECT d."documentId" as "document_id"
            FROM "DocumentText" as d
            WHERE d."documentId" = ANY($1)
            AND d."tokenCount" > 0
        "#,
        attachment_ids as &[String]
    )
    .fetch_all(db)
    .await?;

    Ok(filtered_attachments
        .into_iter()
        .map(|row| row.document_id)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("document_text_verify")))]
    async fn test_batch_verify(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let attachments = batch_verify(
            &pool,
            &vec![
                "document-one".to_string(),   // valid with token count 1000
                "document-two".to_string(),   // valid with token count 1000
                "document-three".to_string(), // invalid with token count 0
                "document-four".to_string(),  // missing document text
            ],
        )
        .await?;

        assert_eq!(attachments.len(), 2);
        assert_eq!(attachments[0], "document-one");
        assert_eq!(attachments[1], "document-two");

        Ok(())
    }
}
