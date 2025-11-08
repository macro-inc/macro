use chrono::{DateTime, Utc};
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_user_messages<'e, E>(
    db: E,
    user_id: &str,
    latest: DateTime<Utc>,
    earliest: DateTime<Utc>,
    limit: usize,
    offset: usize,
) -> Result<Vec<String>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let latest = latest.naive_utc();
    let earliest = earliest.naive_utc();
    let ids = sqlx::query!(
        r#"
    SELECT 
      m.id 
    FROM 
      "ChatMessage" m
    JOIN 
      "Chat" c on c."id" = m."chatId"
    WHERE
      "userId" = $1
    AND
      m."updatedAt" <= $2
    AND 
      m."updatedAt" >= $3
    AND 
      "role" = 'user'
    
    ORDER BY 
      m."updatedAt" DESC
    LIMIT 
      $4
    OFFSET $5
  "#,
        user_id,
        latest,
        earliest,
        limit as i64,
        offset as i64
    )
    .fetch_all(db)
    .await?;
    Ok(ids.into_iter().map(|record| record.id).collect())
}
