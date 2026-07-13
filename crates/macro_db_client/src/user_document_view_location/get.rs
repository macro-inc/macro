use model::user_document_view_location::UserDocumentViewLocation;
use sqlx::{Pool, Postgres};

/// Gets the user document view location
#[tracing::instrument(skip(db))]
pub async fn get_user_document_view_location(
    db: &Pool<Postgres>,
    user_id: &str,
    document_id: &str,
) -> anyhow::Result<Option<UserDocumentViewLocation>> {
    let record = sqlx::query_as!(
        UserDocumentViewLocation,
        r#"
        SELECT user_id, document_id, location
        FROM "UserDocumentViewLocation"
        WHERE user_id = $1 AND document_id = $2
        "#,
        user_id,
        document_id
    )
    .fetch_optional(db)
    .await?;
    Ok(record)
}

// TODO: test
