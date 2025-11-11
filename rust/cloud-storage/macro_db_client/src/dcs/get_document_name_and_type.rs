use std::str::FromStr;

use model::document::FileType;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_document_name_and_type(
    db: Pool<Postgres>,
    id: &str,
) -> anyhow::Result<(String, FileType)> {
    let document_info = sqlx::query!(
        r#"
    SELECT
        d.name,
        d."fileType" as "file_type!"
    FROM
        "Document" d
    WHERE
        d.id = $1 AND d."fileType" IS NOT NULL
    "#,
        id,
    )
    .try_map(|row| {
        let name: String = row.name;
        let file_type_str: String = row.file_type;
        match FileType::from_str(&file_type_str) {
            Some(file_type) => Ok((name, file_type)),
            None => Err(sqlx::Error::ColumnDecode {
                index: "file_type".to_string(),
                source: format!("invalid file type {}", file_type_str).into(),
            }),
        }
    })
    .fetch_one(&db)
    .await?;

    Ok(document_info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_basic_user_with_documents")))]
    async fn test_get_document_name(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let (document_name, document_type) =
            get_document_name_and_type(pool.clone(), "document-one").await?;
        assert_eq!(document_name, "test_document_name".to_string());
        assert_eq!(document_type, FileType::Pdf);
        Ok(())
    }
}
