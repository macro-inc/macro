use crate::SQS;

pub mod enqueue_organization_retention;

impl SQS {
    /// Sets the organization_retention_queue.
    pub fn organization_retention_queue(mut self, organization_retention_queue: &str) -> Self {
        self.organization_retention_queue = Some(organization_retention_queue.to_string());
        self
    }

    /// Bulk enqueues organization retention messages to the organization retention queue
    #[tracing::instrument(skip(self))]
    pub async fn bulk_enqueue_organization_retention(
        &self,
        organizations: Vec<(i32, i32)>,
    ) -> anyhow::Result<()> {
        if let Some(organization_retention_queue) = &self.organization_retention_queue {
            return enqueue_organization_retention::enqueue_organization_retention(
                &self.inner,
                organization_retention_queue,
                organizations,
            )
            .await;
        }

        Err(anyhow::anyhow!(
            "organization_retention_queue is not configured"
        ))
    }
}
