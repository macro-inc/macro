use anyhow::Result;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn upsert_document_text(
    db: &Pool<Postgres>,
    document_id: &str,
    text: &str,
    token_count: i64,
) -> Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "DocumentText" ("documentId", "content", "tokenCount")
        VALUES ($1, $2, $3)
        ON CONFLICT ("documentId")
        DO UPDATE SET "content" = EXCLUDED."content", "tokenCount" = EXCLUDED."tokenCount"
        "#,
        document_id,
        text,
        token_count
    )
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_document_text")))]
    async fn test_upsert_document_text(pool: Pool<Postgres>) -> anyhow::Result<()> {
        upsert_document_text(&pool, "document-one", "UPDATED TEXT", 1000).await?;

        let document_text = sqlx::query!(
            r#"
            SELECT
                "documentId" as "document_id",
                "content" as "content",
                "tokenCount" as "token_count"
            FROM "DocumentText"
            WHERE "documentId" = $1
            "#,
            "document-one"
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(document_text.content, "UPDATED TEXT");
        assert_eq!(document_text.token_count, 1000);

        Ok(())
    }
}
