use redis::AsyncCommands;

/// Sets the user permissions for their session if present
#[tracing::instrument(skip(redis_client))]
pub async fn update_user_permissions(
    redis_client: &redis::Client,
    user_id: &str,
    permissions: &str,
) -> anyhow::Result<()> {
    let mut connection = redis_client.get_multiplexed_async_connection().await?;

    let session_id = connection.get::<&str, Option<String>>(user_id).await?;

    if let Some(session_id) = session_id {
        () = connection.set(session_id.as_str(), permissions).await?;
    }

    Ok(())
}
