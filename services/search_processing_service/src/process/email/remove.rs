use opensearch_client::OpensearchClient;
use uuid::Uuid;

pub async fn process_remove_message(
    opensearch_client: &OpensearchClient,
    message_id: Uuid,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_email_message_by_id(&message_id.to_string(), index_override)
        .await?;

    Ok(())
}

pub async fn process_remove_messages_by_link_id(
    opensearch_client: &OpensearchClient,
    link_id: Uuid,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_email_messages_by_link_id(&link_id.to_string())
        .await?;

    Ok(())
}
