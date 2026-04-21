use opensearch_client::OpensearchClient;
use sqs_client::search::email::{EmailLinkMessage, EmailMessage};

pub async fn process_remove_message(
    opensearch_client: &OpensearchClient,
    remove_message: &EmailMessage,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_email_message_by_id(remove_message.message_id.as_str())
        .await?;

    Ok(())
}

pub async fn process_remove_messages_by_link_id(
    opensearch_client: &OpensearchClient,
    remove_link_message: &EmailLinkMessage,
) -> anyhow::Result<()> {
    opensearch_client
        .delete_email_messages_by_link_id(remove_link_message.link_id.as_str())
        .await?;

    Ok(())
}
