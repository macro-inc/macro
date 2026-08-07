use models_email::email::service::message::Message;
use uuid::Uuid;

use super::super::models::{CalendarPart, EmailApiError, MessageWithCalendarParts, ThreadListPage};
use super::super::ports::{
    MailboxCalendarClient, MailboxMessageClient, ProviderRateLimiter, ProviderTokenSource,
};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxMessageClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Fetches and normalizes one provider message, including any calendar
    /// invitation parts, in a single provider read.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_message(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Option<MessageWithCalendarParts>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::GetMessage).await?;

        self.repository
            .get_message(&access_token, link_id, provider_message_id)
            .await
    }

    /// Fetches the provider label identifiers attached to one message.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_message_label_ids(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::GetMessage).await?;

        self.repository
            .get_message_label_ids(&access_token, provider_message_id)
            .await
    }

    /// Lists message identifiers carrying all requested provider labels.
    #[tracing::instrument(skip(self), err)]
    pub async fn list_messages(
        &self,
        link_id: Uuid,
        limit: u32,
        label_ids: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::ListMessages)
            .await?;

        self.repository
            .list_messages(&access_token, limit, label_ids)
            .await
    }

    /// Lists message identifiers belonging to one provider thread.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_message_ids_for_thread(
        &self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::GetThread).await?;

        self.repository
            .get_message_ids_for_thread(&access_token, provider_thread_id)
            .await
    }

    /// Fetches and normalizes every message in one provider thread.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_thread(
        &self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> Result<Vec<Message>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::GetThread).await?;

        self.repository
            .get_thread(&access_token, link_id, provider_thread_id)
            .await
    }

    /// Lists one page of provider threads.
    #[tracing::instrument(skip(self), err)]
    pub async fn list_threads(
        &self,
        link_id: Uuid,
        limit: u32,
        next_page_token: Option<&str>,
        label_ids: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::ListThreads).await?;

        self.repository
            .list_threads(&access_token, limit, next_page_token, label_ids)
            .await
    }

    /// Applies provider label additions and removals to one message.
    #[tracing::instrument(skip(self), err)]
    pub async fn modify_message_labels(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
        labels_to_add: &[String],
        labels_to_remove: &[String],
    ) -> Result<(), EmailApiError> {
        let access_token = self
            .prepare(link_id, ApiOperationKind::ModifyMessageLabels)
            .await?;

        self.repository
            .modify_message_labels(
                &access_token,
                provider_message_id,
                labels_to_add,
                labels_to_remove,
            )
            .await
    }
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxCalendarClient,
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Finds calendar invitation parts in one provider message via a fresh
    /// provider fetch.
    ///
    /// This charges a full message read; ingest paths that already fetched the
    /// message should consume [`MessageWithCalendarParts::calendar_parts`]
    /// instead. This lookup exists for durable re-extraction jobs.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_calendar_parts(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Vec<CalendarPart>, EmailApiError> {
        let access_token = self.prepare(link_id, ApiOperationKind::GetMessage).await?;
        self.repository
            .get_calendar_parts(&access_token, provider_message_id)
            .await
    }
}

#[cfg(test)]
mod test;
