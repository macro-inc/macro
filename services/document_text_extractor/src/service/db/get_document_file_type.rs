use anyhow::Result;
use model::document::FileType;
use sqlx::{Pool, Postgres};
use std::str::FromStr;

#[cfg_attr(test, allow(dead_code))]
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

    match file_type {
        None => Ok(None),
        Some(ft) => FileType::from_str(&ft)
            .map(Some)
            .map_err(|e| anyhow::anyhow!("invalid fileType value '{}': {}", ft, e)),
    }
}
