use opensearch_client::OpensearchClient;
use uuid::Uuid;

pub async fn process_remove_message(
    opensearch_client: &OpensearchClient,
    message_id: Uuid,
    thread_id: Uuid,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_email_message(
            &message_id.to_string(),
            &thread_id.to_string(),
            index_override,
        )
        .await?;

    Ok(())
}
