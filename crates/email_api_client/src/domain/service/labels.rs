use models_email::email::service::label::Label;
use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxLabelClient, ProviderRateLimiter, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxLabelClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Lists all labels for a linked mailbox.
    pub async fn list_labels(&self, link_id: Uuid) -> Result<Vec<Label>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::ListLabels).await?;

        self.repository.list_labels(&access_token, link_id).await
    }
}

#[cfg(test)]
mod test;
