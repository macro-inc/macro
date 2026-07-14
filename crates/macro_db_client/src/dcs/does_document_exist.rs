use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn does_document_exist(db: Pool<Postgres>, document_id: &str) -> anyhow::Result<bool> {
    let document = sqlx::query!(
        r#"
        SELECT
            d.id
        FROM
            "Document" d
        WHERE
            d.id = $1
        "#,
        document_id,
    )
    .fetch_optional(&db)
    .await?;

    Ok(document.is_some())
}
