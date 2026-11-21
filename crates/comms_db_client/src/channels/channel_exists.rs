/// Whether the channel's row exists.
#[tracing::instrument(skip(db), err)]
pub async fn channel_exists(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &uuid::Uuid,
) -> anyhow::Result<bool> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM comms_channels WHERE id = $1) AS "exists!""#,
        channel_id,
    )
    .fetch_one(db)
    .await?;
    Ok(exists)
}
