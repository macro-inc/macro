use std::collections::HashSet;

/// Checks if a bulk list of user ids exist
/// Returning out a list of users that do not exist
#[tracing::instrument(skip(db))]
pub async fn get_users_that_do_not_exist(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_ids: &[String],
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT "id"
        FROM "User"
        WHERE "id" = ANY($1)
        "#,
        user_ids,
    )
    .fetch_all(db)
    .await?;

    // Put the user ids into a set
    let exists: HashSet<String> = result.iter().map(|r| r.id.clone()).collect();

    let mut does_not_exist: HashSet<String> = HashSet::new();

    for user_id in user_ids {
        // If the user id does not exist, add it to the list
        if !exists.contains(user_id) {
            does_not_exist.insert(user_id.clone());
        }
    }

    Ok(does_not_exist.into_iter().collect())
}
