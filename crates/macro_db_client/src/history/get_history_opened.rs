use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

/// Whether the user's history row for an item has been touched since it was
/// first written: `updatedAt > createdAt`.
///
/// Server-side document creation seeds a history row for the owner with the
/// two timestamps equal, so row *membership* alone can't distinguish "seeded
/// at signup" from "opened by the user" — but every real open goes through
/// the history upsert, which bumps `updatedAt`. `Some(true)` therefore means
/// the user opened the item at least once after the row was created. `None`
/// when the user has no history row for the item at all.
#[tracing::instrument(skip(db))]
pub async fn user_history_item_opened(
    db: &Pool<Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<Option<bool>> {
    let row = sqlx::query!(
        r#"
        SELECT "updatedAt" > "createdAt" AS "opened!"
        FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2 AND "itemType" = $3
        "#,
        user_id,
        item_id,
        item_type,
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| row.opened))
}
