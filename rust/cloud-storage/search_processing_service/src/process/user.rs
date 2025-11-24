use opensearch_client::OpensearchClient;

#[tracing::instrument(skip(opensearch_client))]
pub async fn remove_user_profile(
    opensearch_client: &OpensearchClient,
    user_profile_id: &str,
) -> anyhow::Result<()> {
    if !user_profile_id.starts_with("macro|") {
        anyhow::bail!("user id must start with `macro|`");
    }

    // Delete documents of user
    opensearch_client
        .delete_documents_by_owner_id(user_profile_id)
        .await?;

    // Delete chats of user
    opensearch_client
        .delete_chat_by_user_id(user_profile_id)
        .await?;

    // Delete emails of user
    opensearch_client
        .delete_email_messages_by_user_id(user_profile_id)
        .await?;

    // Delete projects of user
    opensearch_client
        .delete_projects_by_user_id(user_profile_id)
        .await?;

    opensearch_client
        .delete_entities_for_user(user_profile_id)
        .await?;

    Ok(())
}
