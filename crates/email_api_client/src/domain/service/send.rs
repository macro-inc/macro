use uuid::Uuid;

use super::super::models::{
    EmailApiError, PreparedSendMessage, SendRequest, SentIds, validate_message_id,
};
use super::super::ports::{
    MailboxSendClient, MailboxSendRecoveryClient, ProviderRateLimiter, ProviderTokenSource,
};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSendClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Sends a message through the linked mailbox.
    #[tracing::instrument(skip(self, request), err)]
    pub async fn send_message(
        &self,
        link_id: Uuid,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::SendMessage).await?;

        self.repository
            .send_message(&access_token, request, provider_thread_id)
            .await
    }
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSendRecoveryClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Completes quota, token and MIME preparation without dispatching a send.
    /// Persist delivery-started state only after this method succeeds.
    #[tracing::instrument(skip(self, request), err)]
    pub async fn prepare_send(
        &self,
        link_id: Uuid,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<PreparedSendMessage, EmailApiError> {
        let mime = request.build_mime()?;
        let access_token = self.prepare(link_id, ApiOperationKind::SendMessage).await?;
        Ok(PreparedSendMessage {
            access_token,
            mime,
            provider_thread_id: provider_thread_id.map(str::to_owned),
        })
    }

    /// Dispatches the prepared request once. Any ambiguous result must be
    /// reconciled before a caller considers a later delivery attempt.
    #[tracing::instrument(skip_all, err)]
    pub async fn send_prepared(
        &self,
        prepared: &PreparedSendMessage,
    ) -> Result<SentIds, EmailApiError> {
        self.repository
            .send_prepared(
                &prepared.access_token,
                &prepared.mime,
                prepared.provider_thread_id.as_deref(),
            )
            .await
    }

    /// Checks sent mail for a stable delivery identifier without sending again.
    #[tracing::instrument(skip(self, message_id), err)]
    pub async fn find_sent_message(
        &self,
        link_id: Uuid,
        message_id: &str,
    ) -> Result<Option<SentIds>, EmailApiError> {
        validate_message_id(message_id)?;
        let access_token = self
            .prepare(link_id, ApiOperationKind::ListMessages)
            .await?;
        self.repository
            .find_sent_message(&access_token, message_id)
            .await
    }
}

#[cfg(test)]
mod test;
