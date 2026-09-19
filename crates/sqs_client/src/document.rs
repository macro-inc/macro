use crate::SQS;

pub mod enqueue_delete_document;

impl SQS {
    /// Sets the document_delete_queue.
    pub fn document_delete_queue(mut self, document_delete_queue: &str) -> Self {
        self.document_delete_queue = Some(document_delete_queue.to_string());
        self
    }

    /// Bulk enqueues document delete messages to the document delete queue
    #[tracing::instrument(skip(self))]
    pub async fn bulk_enqueue_document_delete(&self, documents: Vec<String>) -> anyhow::Result<()> {
        if let Some(document_delete_queue) = &self.document_delete_queue {
            return enqueue_delete_document::bulk_enqueue_document_delete(
                &self.inner,
                document_delete_queue,
                documents,
            )
            .await;
        }

        Err(anyhow::anyhow!("document_delete_queue is not configured"))
    }

    /// Bulk enqueues document delete messages with document owner to the document delete queue
    #[tracing::instrument(skip(self))]
    pub async fn bulk_enqueue_document_delete_with_owner(
        &self,
        document_id_owner: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        if let Some(document_delete_queue) = &self.document_delete_queue {
            return enqueue_delete_document::bulk_enqueue_document_delete_with_owner(
                &self.inner,
                document_delete_queue,
                document_id_owner,
            )
            .await;
        }

        Err(anyhow::anyhow!("document_delete_queue is not configured"))
    }

    /// enqueues document delete messages to the document delete queue
    #[tracing::instrument(skip(self))]
    pub async fn enqueue_document_delete(
        &self,
        user_id: &str,
        document_id: &str,
    ) -> anyhow::Result<()> {
        if let Some(document_delete_queue) = &self.document_delete_queue {
            return enqueue_delete_document::enqueue_document_delete(
                &self.inner,
                document_delete_queue,
                user_id,
                document_id,
            )
            .await;
        }

        Err(anyhow::anyhow!("document_delete_queue is not configured"))
    }
}
