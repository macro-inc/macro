use sqlx::types::Uuid;

/// Creates user notifications for a given notification
#[tracing::instrument(skip(transaction, user_ids))]
pub async fn create_bulk_user_notifications(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    notification_id: &Uuid,
    user_ids: &[String],
    is_important_v0: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO user_notification ("notification_id", "user_id", "is_important_v0") 
        SELECT $1, user_id, $3
        FROM UNNEST($2::text[]) as user_id
        "#,
        notification_id,
        user_ids,
        is_important_v0,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_notifications")))]
    async fn test_create_bulk_user_notifications(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;
        create_bulk_user_notifications(
            &mut transaction,
            &"0193b1ea-a542-7589-893b-2b4a509c1e76".parse().unwrap(),
            &[
                "macro|user2@user.com".to_string(),
                "macro|user3@user.com".to_string(),
            ],
            true,
        )
        .await?;

        Ok(())
    }
}
