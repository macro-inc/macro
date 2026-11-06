use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::super::models::{EmailApiError, SenderDomain};
use super::super::ports::{MailboxSenderActivityClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSenderActivityClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Counts messages received from `domain` since `since`, retrying once
    /// with a fresh token if the provider rejects the cached one.
    ///
    /// Admission and token failures are logged here. A provider failure is
    /// left to the caller, which treats a count as a ranking signal and logs
    /// it at its own level.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn count_messages_from_domain(
        &self,
        link_id: Uuid,
        domain: &SenderDomain,
        since: DateTime<Utc>,
    ) -> Result<u32, EmailApiError> {
        self.retry_with_fresh_token(
            link_id,
            ApiOperationKind::ListMessages,
            |token| async move {
                self.repository
                    .count_messages_from_domain(&token, domain, since)
                    .await
            },
        )
        .await?
    }
}
