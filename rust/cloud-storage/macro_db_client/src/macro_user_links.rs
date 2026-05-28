//! Directed links between macro_ids. Used by multi-inbox so a primary macro user can
//! read another macro user's inbox without merging identities. The "what" of the
//! delegation is implicit — primary may read child's email_links rows.

use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

/// Insert an edge `(primary, child)`. Idempotent: if the edge already exists
/// the conflict is swallowed.
#[tracing::instrument(skip(db), err)]
pub async fn insert_edge(
    db: &Pool<Postgres>,
    primary_macro_id: &str,
    child_macro_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO macro_user_links (primary_macro_id, child_macro_id)
            VALUES ($1, $2)
            ON CONFLICT (primary_macro_id, child_macro_id) DO NOTHING
        "#,
        primary_macro_id,
        child_macro_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Remove an edge. No-op if the edge does not exist.
#[tracing::instrument(skip(db), err)]
pub async fn delete_edge(
    db: &Pool<Postgres>,
    primary_macro_id: &str,
    child_macro_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM macro_user_links
            WHERE primary_macro_id = $1
              AND child_macro_id = $2
        "#,
        primary_macro_id,
        child_macro_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Returns the `child_macro_id`s the given primary delegates from.
/// Used by email-service to union linked inboxes with the user's own.
#[tracing::instrument(skip(db), err)]
pub async fn children_for_primary(
    db: &Pool<Postgres>,
    primary_macro_id: &str,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar!(
        r#"
            SELECT child_macro_id
            FROM macro_user_links
            WHERE primary_macro_id = $1
        "#,
        primary_macro_id
    )
    .fetch_all(db)
    .await?;

    Ok(rows)
}
