use anyhow::Context;
use sqlx::{Pool, Postgres};

/// Gets all shas and their counts from the database
#[tracing::instrument(skip(db))]
pub async fn get_shas(db: Pool<Postgres>) -> anyhow::Result<Vec<(String, i64)>> {
    let result = sqlx::query!(
        r#"
        SELECT sha, COUNT(*) as count
        FROM "BomPart"
        GROUP BY sha
        "#
    )
    .fetch_all(&db)
    .await?;

    let result = result
        .iter()
        .map(|row| {
            let count: i64 = row.count.context("expected count to be present").unwrap();
            (row.sha.clone(), count)
        })
        .collect::<Vec<(String, i64)>>();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("shas")))]
    async fn test_get_shas(pool: Pool<Postgres>) {
        let result = get_shas(pool).await.unwrap();
        assert_eq!(result.len(), 4);
        assert_eq!(result[0].0, "sha-4".to_string());
        assert_eq!(result[0].1, 1);
        assert_eq!(result[1].0, "sha-3".to_string());
        assert_eq!(result[1].1, 1);
        assert_eq!(result[2].0, "sha-2".to_string());
        assert_eq!(result[2].1, 2);
        assert_eq!(result[3].0, "sha-1".to_string());
        assert_eq!(result[3].1, 2);
    }
}
