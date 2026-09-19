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
    #[tracing::instrument(skip(self), err)]
    pub async fn list_labels(&self, link_id: Uuid) -> Result<Vec<Label>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::ListLabels).await?;

        self.repository.list_labels(&access_token, link_id).await
    }

    /// Creates a user label.
    #[tracing::instrument(skip(self), err)]
    pub async fn create_label(
        &self,
        link_id: Uuid,
        label_name: &str,
    ) -> Result<Label, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::CreateLabel).await?;

        self.repository
            .create_label(&access_token, link_id, label_name)
            .await
    }

    /// Deletes a provider label.
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_label(
        &self,
        link_id: Uuid,
        provider_label_id: &str,
    ) -> Result<(), EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::DeleteLabel).await?;

        self.repository
            .delete_label(&access_token, provider_label_id)
            .await
    }
}

#[cfg(test)]
mod test;
