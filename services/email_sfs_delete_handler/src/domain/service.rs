use super::ports::{DeleteQueue, OrphanRepository, SfsDeleteService};

pub(crate) struct OrphanCleanup<R, Q> {
    repository: R,
    queue: Q,
}

impl<R, Q> OrphanCleanup<R, Q> {
    pub(crate) fn new(repository: R, queue: Q) -> Self {
        Self { repository, queue }
    }
}

impl<R: OrphanRepository, Q: DeleteQueue> SfsDeleteService for OrphanCleanup<R, Q> {
    async fn enqueue_orphaned_attachments(&self) {
        let messages = self.repository.find_orphaned().await.unwrap_or_else(|e| {
            tracing::error!(error=?e, "Error fetching orphaned sfs attachments");
            Vec::new()
        });

        if !messages.is_empty() {
            tracing::info!(count = messages.len(), "Sending sfs delete messages");
        } else {
            tracing::info!("No orphaned sfs attachments found");
        }

        for message in messages.into_iter() {
            let db_id = message.db_id;
            let sfs_id = message.sfs_id;
            if let Err(e) = self.queue.enqueue(message).await {
                tracing::error!(
                    error=?e,
                    db_id = %db_id,
                    sfs_id = %sfs_id,
                    "Error enqueueing sfs delete message",
                );
            };
        }
    }
}

#[cfg(test)]
mod test;
