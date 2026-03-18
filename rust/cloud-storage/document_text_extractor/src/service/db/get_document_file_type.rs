use anyhow::Result;
use model::document::FileType;
use sqlx::{Pool, Postgres};
use std::str::FromStr;

#[tracing::instrument(skip(db))]
pub async fn get_document_file_type(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<Option<FileType>> {
    let file_type: Option<String> = sqlx::query_scalar!(
        r#"SELECT "fileType" as "file_type?" FROM "Document" WHERE id = $1"#,
        document_id,
    )
    .fetch_one(db)
    .await?;

    Ok(file_type.and_then(|ft| FileType::from_str(&ft).ok()))
}
