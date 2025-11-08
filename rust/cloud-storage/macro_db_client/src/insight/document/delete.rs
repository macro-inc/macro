use anyhow::{Context, Error};
use sqlx::{Executor, Postgres};

pub async fn delete_document_summaries<'e, E>(db: E, ids: &[String]) -> Result<Vec<String>, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let ids = sqlx::query!(
        r#"
        DELETE FROM "DocumentSummary" WHERE id = ANY($1)
        RETURNING id
    "#,
        &ids,
    )
    .fetch_all(db)
    .await
    .context("failed to delete insights")?;

    Ok(ids.into_iter().map(|r| r.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_document_summary")))]
    async fn test_delete_document_summaries(pool: Pool<Postgres>) {
        let ids = vec!["delete-one".to_string(), "delete-two".to_string()];
        let ids = delete_document_summaries(&pool, &ids)
            .await
            .expect("failed to delete insights");
        println!("DELETED {:?}", ids);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"delete-one".to_string()));
        assert!(ids.contains(&"delete-two".to_string()));
    }
}
