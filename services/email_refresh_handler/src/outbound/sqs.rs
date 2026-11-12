use std::sync::Arc;

use models_email::email::service::pubsub::LinkManagerMessage;

use crate::domain::ports::LinkManagerQueue;

pub(crate) struct SqsLinkManagerQueue {
    client: Arc<sqs_client::SQS>,
}

impl SqsLinkManagerQueue {
    pub(crate) fn new(client: Arc<sqs_client::SQS>) -> Self {
        Self { client }
    }
}

impl LinkManagerQueue for SqsLinkManagerQueue {
    type Error = anyhow::Error;

    async fn enqueue_link_manager_notification(
        &self,
        notification: LinkManagerMessage,
    ) -> Result<(), Self::Error> {
        self.client
            .enqueue_link_manager_notification(notification)
            .await
    }
}
