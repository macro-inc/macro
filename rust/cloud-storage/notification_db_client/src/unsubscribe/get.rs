use model_notifications::UserUnsubscribe;

/// Gets the combined list of a users unsubscribe items and unsubscribe item events
#[tracing::instrument(skip(db))]
pub async fn get_user_unsubscribes(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<UserUnsubscribe>> {
    let result: Vec<UserUnsubscribe> = sqlx::query!(
        r#"
        SELECT
            'item' as unsubscribe_type,
            unsubscribe_item.item_id  as "item_id!",
            unsubscribe_item.item_type as "item_type!"
        FROM
            user_notification_item_unsubscribe unsubscribe_item
        WHERE
            unsubscribe_item.user_id = $1
    "#,
        user_id
    )
    .map(|row| UserUnsubscribe {
        item_id: row.item_id,
        item_type: row.item_type,
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_unsubscribes")))]
    async fn test_get_user_unsubscribes(pool: Pool<Postgres>) {
        let result = get_user_unsubscribes(&pool, "no-user").await.unwrap();
        assert_eq!(result.len(), 0);

        let result = get_user_unsubscribes(&pool, "macro|user@user.com")
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
    }
}
