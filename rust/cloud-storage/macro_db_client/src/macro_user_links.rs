//! Capability delegations between macro_ids. Used by multi-inbox to give a primary
//! macro user read access to another macro user's inbox without merging identities.

use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

/// Capability granted by an edge in the macro_user_links graph.
/// Only `Inbox` is wired up today; the column stays flexible for future delegations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    /// Primary may read+write the child's email inbox (Gmail, etc.).
    Inbox,
}

impl Capability {
    fn as_str(&self) -> &'static str {
        match self {
            Capability::Inbox => "inbox",
        }
    }
}

/// Insert an edge `(primary, child, capability)`. Idempotent: if the edge already exists
/// the conflict is swallowed.
#[tracing::instrument(skip(db), err)]
pub async fn insert_edge(
    db: &Pool<Postgres>,
    primary_macro_id: &str,
    child_macro_id: &str,
    capability: Capability,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO macro_user_links (primary_macro_id, child_macro_id, capability)
            VALUES ($1, $2, $3)
            ON CONFLICT (primary_macro_id, child_macro_id, capability) DO NOTHING
        "#,
        primary_macro_id,
        child_macro_id,
        capability.as_str()
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
    capability: Capability,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM macro_user_links
            WHERE primary_macro_id = $1
              AND child_macro_id = $2
              AND capability = $3
        "#,
        primary_macro_id,
        child_macro_id,
        capability.as_str()
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Returns the `child_macro_id`s the given primary holds the `Inbox` capability over.
/// Used by email-service to union linked inboxes with the user's own.
#[tracing::instrument(skip(db), err)]
pub async fn inbox_children_for_primary(
    db: &Pool<Postgres>,
    primary_macro_id: &str,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar!(
        r#"
            SELECT child_macro_id
            FROM macro_user_links
            WHERE primary_macro_id = $1
              AND capability = 'inbox'
        "#,
        primary_macro_id
    )
    .fetch_all(db)
    .await?;

    Ok(rows)
}
