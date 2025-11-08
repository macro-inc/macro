use redis::AsyncCommands;

/// Adds a permission to the list of user permissions for their session if present
#[tracing::instrument(skip(redis_client))]
pub async fn add_user_permission(
    redis_client: &redis::Client,
    user_id: &str,
    permission: &str,
) -> anyhow::Result<()> {
    let mut connection = redis_client.get_multiplexed_async_connection().await?;

    let session_id = connection.get::<&str, Option<String>>(user_id).await?;

    if let Some(session_id) = session_id {
        let mut permissions = connection.get::<&str, String>(session_id.as_str()).await?;
        if !permissions.contains(permission) {
            permissions += format!(",{}", permission).as_str();
            () = connection.set(session_id.as_str(), permissions).await?;
        }
    }

    Ok(())
}
