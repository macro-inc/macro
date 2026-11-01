//! Gmail history keeps its existing transport while sharing the durable journal invariant.

use super::*;
use email_api_client::domain::models::ChangeBatch;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum HistoryWork {
    Upsert { provider_id: String },
    Delete { provider_id: String },
    Labels { provider_id: String },
}
pub trait GmailHistoryRepository: Send + Sync + 'static {
    fn commit_history(
        &self,
        link: Uuid,
        expected: &str,
        next: &str,
        work: &[HistoryWork],
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
#[derive(Clone)]
pub struct GmailHistoryService<R>(pub R);
impl<R: GmailHistoryRepository> GmailHistoryService<R> {
    pub async fn accept(
        &self,
        link: Uuid,
        expected: &str,
        batch: ChangeBatch,
    ) -> Result<(), MailboxError> {
        let old = expected
            .parse::<u64>()
            .map_err(|_| MailboxError::InvalidInput("invalid Gmail cursor"))?;
        let next = batch
            .next_cursor
            .as_str()
            .parse::<u64>()
            .map_err(|_| MailboxError::InvalidInput("invalid Gmail cursor"))?;
        if next < old {
            return Err(MailboxError::Stale);
        }
        let mut work = Vec::new();
        work.extend(
            batch
                .changes
                .message_ids_to_upsert
                .into_iter()
                .map(|provider_id| HistoryWork::Upsert { provider_id }),
        );
        work.extend(
            batch
                .changes
                .message_ids_to_delete
                .into_iter()
                .map(|provider_id| HistoryWork::Delete { provider_id }),
        );
        work.extend(
            batch
                .changes
                .labels_to_update
                .into_iter()
                .map(|provider_id| HistoryWork::Labels { provider_id }),
        );
        self.0
            .commit_history(link, expected, batch.next_cursor.as_str(), &work)
            .await
    }
}
