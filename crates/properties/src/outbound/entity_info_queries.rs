//! Cross-entity lookup query helpers (document names, user profile pictures).
//!
//! These queries read tables owned by other domains but are needed by the
//! properties domain (e.g. to render relation property values). They are
//! inlined here so this crate does not depend on the monolithic db client
//! crates.

use sqlx::{Pool, Postgres};

/// Get the name of a document by ID.
/// Returns `None` if the document doesn't exist.
/// Tasks are stored as documents, so this works for both documents and tasks.
pub async fn get_document_name(
    pool: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<Option<String>> {
    let name = sqlx::query_scalar!(
        r#"
        SELECT d.name
        FROM "Document" d
        WHERE d."id" = $1
        "#,
        document_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(name)
}

/// Get the profile picture URL for a user (by `"User"` profile id).
/// Returns `None` if the user doesn't exist or has no profile picture.
pub async fn get_user_profile_picture(
    pool: &Pool<Postgres>,
    user_id: &str,
) -> anyhow::Result<Option<String>> {
    let url = sqlx::query_scalar!(
        r#"
        SELECT mui.profile_picture as "profile_picture!"
        FROM "User" u
        JOIN macro_user mu ON mu.id = u.macro_user_id
        JOIN macro_user_info mui ON mui.macro_user_id = mu.id
        WHERE u.id = $1 AND mui.profile_picture IS NOT NULL
        "#,
        user_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(url)
}
