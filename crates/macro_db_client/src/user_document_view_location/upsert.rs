use sqlx::{Pool, Postgres};

/// Upserts the user document view location
#[tracing::instrument(skip(db))]
pub async fn upsert_user_document_view_location(
    db: &Pool<Postgres>,
    user_id: &str,
    document_id: &str,
    location: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "UserDocumentViewLocation" (user_id, document_id, location)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, document_id) 
        DO UPDATE SET location = EXCLUDED.location, updated_at = NOW()
        "#,
        user_id,
        document_id,
        location
    )
    .execute(db)
    .await?;
    Ok(())
}

// TODO: Add tests
