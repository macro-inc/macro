use model::document::{BomPart, SaveBomPart};

/// Saves the bom parts to the db under the documents bom id
#[tracing::instrument(skip(db, bom_parts))]
pub async fn save_bom_parts_to_db(
    db: &sqlx::Pool<sqlx::Postgres>,
    bom_parts: &[SaveBomPart],
    document_bom_id: i64,
) -> anyhow::Result<Vec<BomPart>> {
    let mut query = r#"INSERT INTO "BomPart" ("documentBomId", "sha", "path") VALUES"#.to_string();
    let mut set_parts: Vec<String> = Vec::new();
    let mut parameters: Vec<String> = Vec::new();

    for bom_part in bom_parts {
        let param_number = parameters.len() + 2;
        set_parts.push(format!("($1, ${}, ${})", param_number, param_number + 1));

        parameters.push(bom_part.sha.clone());
        parameters.push(bom_part.path.clone());
    }

    query += &set_parts.join(", ");
    query += " RETURNING id, sha, path;";

    let mut query = sqlx::query_as::<_, BomPart>(&query);
    query = query.bind(document_bom_id);

    for param in parameters {
        query = query.bind(param);
    }

    let result = query.fetch_all(db).await?;

    Ok(result)
}

/// Updates the `uploaded` status of the document to be true.
#[tracing::instrument(skip(db))]
pub async fn update_uploaded_status(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE "Document" SET "uploaded" = true WHERE id = $1"#,
        document_id
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Saves the job id to the db under the documents id
#[tracing::instrument(skip(db))]
pub async fn get_job_for_docx_upload(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<Option<(String, String)>> {
    let result: Option<(String, String)> = match sqlx::query!(
        r#"
        SELECT "jobId" as job_id, "jobType" as job_type FROM "UploadJob" WHERE "documentId" = $1
        "#,
        document_id
    )
    .fetch_one(db)
    .await
    {
        Ok(result) => Some((result.job_id, result.job_type)),
        Err(err) => match err {
            sqlx::Error::RowNotFound => None,
            _ => return Err(err.into()),
        },
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document.sql")))]
    async fn test_save_bom_parts_to_db(pool: Pool<Postgres>) {
        let result = save_bom_parts_to_db(
            &pool,
            &[
                SaveBomPart {
                    sha: "sha_2".to_string(),
                    path: "path_2".to_string(),
                },
                SaveBomPart {
                    sha: "sha_3".to_string(),
                    path: "path_3".to_string(),
                },
                SaveBomPart {
                    sha: "sha_4".to_string(),
                    path: "path_4".to_string(),
                },
            ],
            1,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 3);

        let result = match sqlx::query_as!(
            BomPart,
            r#"
                SELECT id, "sha", "path" FROM "BomPart"
                WHERE "documentBomId" = $1;
                 "#,
            1
        )
        .fetch_all(&pool)
        .await
        {
            Ok(result) => result,
            Err(e) => {
                panic!("{e}");
            }
        };

        assert_eq!(result.len(), 3);
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document.sql")))]
    async fn test_update_uploaded_status(pool: Pool<Postgres>) -> anyhow::Result<()> {
        update_uploaded_status(&pool, "document-one").await?;

        let uploaded = sqlx::query!(
            r#"
            SELECT uploaded
            FROM "Document"
            WHERE id = $1
            "#,
            "document-one"
        )
        .map(|row| row.uploaded)
        .fetch_one(&pool)
        .await?;

        assert!(uploaded);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_with_document.sql")))]
    async fn test_get_job_id_for_docx_upload(pool: Pool<Postgres>) {
        let result = get_job_for_docx_upload(&pool, "document-one").await;

        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            Some(("job-id".to_string(), "job-type".to_string()))
        );

        let result = get_job_for_docx_upload(&pool, "document-none").await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }
}
