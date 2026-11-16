use std::sync::Arc;

use crate::domain::{models::OrphanedAttachment, ports::DeleteQueue};

pub(crate) struct SqsDeleteQueue {
    client: Arc<sqs_client::SQS>,
}

impl SqsDeleteQueue {
    pub(crate) fn new(client: Arc<sqs_client::SQS>) -> Self {
        Self { client }
    }
}

impl DeleteQueue for SqsDeleteQueue {
    type Error = anyhow::Error;

    async fn enqueue(&self, attachment: OrphanedAttachment) -> Result<(), Self::Error> {
        self.client
            .enqueue_sfs_delete_message(sqs_client::email::SFSDeleteMessage {
                db_id: attachment.db_id,
                sfs_id: attachment.sfs_id,
            })
            .await
    }
}
