use uuid::Uuid;

use super::super::models::{
    EmailApiError, PreparedSendMessage, SendRequest, SentIds, TokenFreshness, validate_message_id,
};
use super::super::ports::{
    MailboxSendClient, MailboxSendRecoveryClient, ProviderRequestGate, ProviderTokenSource,
};
use super::{ApiOperationKind, EmailApiClientServiceImpl, log_operation_error};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSendClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Sends a message through the linked mailbox.
    #[tracing::instrument(skip(self, request))]
    pub async fn send_message(
        &self,
        link_id: Uuid,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        self.call_with_token(link_id, ApiOperationKind::SendMessage, |token| async move {
            self.repository
                .send_message(&token, request, provider_thread_id)
                .await
                .inspect_err(log_operation_error)
        })
        .await
    }
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSendRecoveryClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Completes admission, token and MIME preparation without dispatching a
    /// send. Persist delivery-started state only after this method succeeds.
    #[tracing::instrument(skip(self, request))]
    pub async fn prepare_send(
        &self,
        link_id: Uuid,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<PreparedSendMessage, EmailApiError> {
        let mime = request.build_mime().inspect_err(log_operation_error)?;
        let permit = self.admit(link_id, ApiOperationKind::SendMessage).await?;
        let access_token = match self
            .get_access_token(link_id, TokenFreshness::Cached)
            .await
            .inspect_err(log_operation_error)
        {
            Ok(access_token) => access_token,
            Err(error) => {
                self.gate.finish(link_id, permit, None).await;
                return Err(error);
            }
        };
        Ok(PreparedSendMessage {
            link_id,
            permit,
            access_token,
            mime,
            provider_thread_id: provider_thread_id.map(str::to_owned),
        })
    }

    /// Dispatches the prepared request once. Any ambiguous result must be
    /// reconciled before a caller considers a later delivery attempt.
    #[tracing::instrument(skip_all)]
    pub async fn send_prepared(
        &self,
        prepared: &PreparedSendMessage,
    ) -> Result<SentIds, EmailApiError> {
        let result = self
            .repository
            .send_prepared(
                &prepared.access_token,
                &prepared.mime,
                prepared.provider_thread_id.as_deref(),
            )
            .await;
        self.gate
            .finish(prepared.link_id, prepared.permit, result.as_ref().err())
            .await;
        result.inspect_err(log_operation_error)
    }

    /// Checks sent mail for a stable delivery identifier without sending again.
    #[tracing::instrument(skip(self, message_id))]
    pub async fn find_sent_message(
        &self,
        link_id: Uuid,
        message_id: &str,
    ) -> Result<Option<SentIds>, EmailApiError> {
        validate_message_id(message_id).inspect_err(log_operation_error)?;
        self.call_with_token(
            link_id,
            ApiOperationKind::ListMessages,
            |token| async move {
                self.repository
                    .find_sent_message(&token, message_id)
                    .await
                    .inspect_err(log_operation_error)
            },
        )
        .await
    }
}

#[cfg(test)]
mod test;
