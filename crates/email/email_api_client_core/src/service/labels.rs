use models_email::email::service::label::Label;
use uuid::Uuid;

use super::super::models::EmailApiError;
use super::super::ports::{MailboxLabelClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl, log_operation_error};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxLabelClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Lists all labels for a linked mailbox.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn list_labels(&self, link_id: Uuid) -> Result<Vec<Label>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::ListLabels, |token| async move {
            self.repository.list_labels(&token, link_id).await
        })
        .await
    }

    /// Creates a user label.
    #[tracing::instrument(skip(self), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn create_label(
        &self,
        link_id: Uuid,
        label_name: &str,
    ) -> Result<Label, EmailApiError> {
        self.call_with_token(link_id, ApiOperationKind::CreateLabel, |token| async move {
            self.repository
                .create_label(&token, link_id, label_name)
                .await
                .inspect_err(log_operation_error)
        })
        .await
    }

    /// Deletes a provider label.
    #[tracing::instrument(skip(self), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn delete_label(
        &self,
        link_id: Uuid,
        provider_label_id: &str,
    ) -> Result<(), EmailApiError> {
        self.call_with_token(link_id, ApiOperationKind::DeleteLabel, |token| async move {
            self.repository
                .delete_label(&token, provider_label_id)
                .await
                .inspect_err(log_operation_error)
        })
        .await
    }
}

#[cfg(test)]
mod test;
