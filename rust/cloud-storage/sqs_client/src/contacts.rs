use crate::SQS;
use model::contacts::{
    AddParticipantsMessageBody, ConnectionsMessage, CreateGroupMessageBody, Message,
};

impl SQS {
    pub fn contacts_queue(mut self, contacts_queue: &str) -> Self {
        self.contacts_queue = Some(contacts_queue.to_string());
        self
    }

    #[tracing::instrument(skip(self))]
    pub async fn enqueue_contacts_add_participants(
        &self,
        new_participants: Vec<String>,
        channel_participants: Vec<String>,
        channel_id: &str,
    ) -> anyhow::Result<()> {
        if let Some(contacts_queue) = &self.contacts_queue {
            return enqueue_contacts_add_participants(
                &self.inner,
                contacts_queue,
                new_participants,
                channel_participants,
                channel_id,
            )
            .await;
        }
        Err(anyhow::anyhow!("contacts_queue is not configured"))
    }

    #[tracing::instrument(skip(self))]
    pub async fn enqueue_contacts_create_channel(
        &self,
        participants: Vec<String>,
        channel_id: &str,
    ) -> anyhow::Result<()> {
        if let Some(contacts_queue) = &self.contacts_queue {
            return enqueue_contacts_create_channel(
                &self.inner,
                contacts_queue,
                participants,
                channel_id,
            )
            .await;
        }

        Err(anyhow::anyhow!("contacts_queue is not configured"))
    }

    #[tracing::instrument(skip(self))]
    pub async fn enqueue_contacts_add_connection(
        &self,
        connections_message: ConnectionsMessage,
    ) -> anyhow::Result<()> {
        if let Some(contacts_queue) = &self.contacts_queue {
            return enqueue_contacts_add_connection(
                &self.inner,
                contacts_queue,
                connections_message,
            )
            .await;
        }
        Err(anyhow::anyhow!("contacts_queue is not configured"))
    }
}

#[tracing::instrument(skip(sqs_client, participants))]
pub async fn enqueue_contacts_create_channel(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    participants: Vec<String>,
    channel_id: &str,
) -> anyhow::Result<()> {
    let body = CreateGroupMessageBody {
        group: participants,
        group_id: Some(channel_id.to_string()),
    };
    let message = Message::CreateGroup(body);
    let message_str = serde_json::to_string(&message)?;
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}

#[tracing::instrument(skip(sqs_client, new_participants, channel_participants))]
pub async fn enqueue_contacts_add_participants(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    new_participants: Vec<String>,
    channel_participants: Vec<String>,
    channel_id: &str,
) -> anyhow::Result<()> {
    let body = AddParticipantsMessageBody {
        group: channel_participants,
        participants: new_participants,
        group_id: Some(channel_id.to_string()),
    };
    let message = Message::AddParticipants(body);
    let message_str = serde_json::to_string(&message)?;
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}

#[tracing::instrument(skip(sqs_client, queue_url))]
pub async fn enqueue_contacts_add_connection(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    connections_message: ConnectionsMessage,
) -> anyhow::Result<()> {
    let message = Message::AddConnection(connections_message);
    let message_str = serde_json::to_string(&message)?;
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}
