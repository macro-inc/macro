use super::SyncServiceClient;
use sync_service_hex::domain::ports::SyncWakeupService;

impl SyncServiceClient {
    pub fn bulk_wakeup_fire_and_forget(&self, document_ids: Vec<String>) -> usize {
        let dispatched = document_ids.len();

        for document_id in document_ids {
            self.wakeup_fire_and_forget(document_id);
        }

        dispatched
    }

    pub fn wakeup_fire_and_forget(&self, document_id: String) {
        let client = self.client.clone();
        let full_url = format!("{}/document/{}/wakeup", self.url, document_id);

        std::mem::drop(tokio::spawn(async move {
            if let Err(error) = client.head(&full_url).send().await {
                tracing::warn!(
                    error = ?error,
                    document_id = %document_id,
                    "failed to dispatch sync service wakeup",
                );
            }
        }));
    }
}

impl SyncWakeupService for SyncServiceClient {
    fn bulk_wakeup(&self, document_ids: Vec<String>) -> usize {
        self.bulk_wakeup_fire_and_forget(document_ids)
    }
}
