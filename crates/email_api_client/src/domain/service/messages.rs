use uuid::Uuid;

use super::super::models::{CalendarPart, EmailApiError, MessageWithCalendarParts, ThreadListPage};
use super::super::ports::{
    MailboxCalendarClient, MailboxMessageClient, ProviderRequestGate, ProviderTokenSource,
};
use super::{ApiOperationKind, EmailApiClientServiceImpl, log_operation_error};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxMessageClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Fetches and normalizes one provider message, including any calendar
    /// invitation parts, in a single provider read.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_message(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Option<MessageWithCalendarParts>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetMessage, |token| async move {
            self.repository
                .get_message(&token, link_id, provider_message_id)
                .await
        })
        .await
    }

    /// Fetches the provider label identifiers attached to one message.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_message_label_ids(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetMessage, |token| async move {
            self.repository
                .get_message_label_ids(&token, provider_message_id)
                .await
        })
        .await
    }

    /// Lists message identifiers carrying all requested provider labels.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn list_messages(
        &self,
        link_id: Uuid,
        limit: u32,
        label_ids: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        self.read_with_token(
            link_id,
            ApiOperationKind::ListMessages,
            |token| async move {
                self.repository
                    .list_messages(&token, limit, label_ids)
                    .await
            },
        )
        .await
    }

    /// Lists message identifiers belonging to one provider thread.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_message_ids_for_thread(
        &self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetThread, |token| async move {
            self.repository
                .get_message_ids_for_thread(&token, provider_thread_id)
                .await
        })
        .await
    }

    /// Fetches and normalizes every message in one provider thread, with any
    /// calendar invitation parts, in a single provider read.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_thread(
        &self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> Result<Vec<MessageWithCalendarParts>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetThread, |token| async move {
            self.repository
                .get_thread(&token, link_id, provider_thread_id)
                .await
        })
        .await
    }

    /// Lists one page of provider threads.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn list_threads(
        &self,
        link_id: Uuid,
        limit: u32,
        next_page_token: Option<&str>,
        label_ids: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::ListThreads, |token| async move {
            self.repository
                .list_threads(&token, limit, next_page_token, label_ids)
                .await
        })
        .await
    }

    /// Applies provider label additions and removals to messages. Fewer than
    /// ten go out one request each, which costs less quota than one batch
    /// request; larger writes use one batch request. With separate requests,
    /// the gate fields record the last one's admission, the request whose
    /// outcome the call returns.
    #[tracing::instrument(skip(self, provider_message_ids), fields(message_count = provider_message_ids.len(), gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn modify_message_labels(
        &self,
        link_id: Uuid,
        provider_message_ids: &[String],
        labels_to_add: &[String],
        labels_to_remove: &[String],
    ) -> Result<(), EmailApiError> {
        match provider_message_ids {
            [] => Ok(()),
            [provider_message_id] => {
                self.modify_one_message_labels(
                    link_id,
                    provider_message_id,
                    labels_to_add,
                    labels_to_remove,
                    false,
                )
                .await
            }
            _ if provider_message_ids.len() < SEPARATE_LABEL_WRITES_BELOW => {
                for provider_message_id in provider_message_ids {
                    self.modify_one_message_labels(
                        link_id,
                        provider_message_id,
                        labels_to_add,
                        labels_to_remove,
                        true,
                    )
                    .await?;
                }
                Ok(())
            }
            _ => {
                self.call_with_token(
                    link_id,
                    ApiOperationKind::BatchModifyMessageLabels,
                    |token| async move {
                        self.repository
                            .batch_modify_message_labels(
                                &token,
                                provider_message_ids,
                                labels_to_add,
                                labels_to_remove,
                            )
                            .await
                            .inspect_err(log_operation_error)
                    },
                )
                .await
            }
        }
    }

    /// Writes one message's labels. With `skip_missing`, a message the mailbox
    /// no longer has counts as written, as it does in a batch request.
    #[tracing::instrument(skip(self, labels_to_add, labels_to_remove), fields(gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn modify_one_message_labels(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
        labels_to_add: &[String],
        labels_to_remove: &[String],
        skip_missing: bool,
    ) -> Result<(), EmailApiError> {
        let result = self
            .call_with_token(
                link_id,
                ApiOperationKind::ModifyMessageLabels,
                |token| async move {
                    self.repository
                        .modify_message_labels(
                            &token,
                            provider_message_id,
                            labels_to_add,
                            labels_to_remove,
                        )
                        .await
                        .inspect_err(|error| {
                            if !(skip_missing && *error == EmailApiError::NotFound) {
                                log_operation_error(error);
                            }
                        })
                },
            )
            .await;
        match result {
            Err(EmailApiError::NotFound) if skip_missing => Ok(()),
            result => result,
        }
    }
}

/// Gmail charges 5 quota units per `messages.modify` and 50 per
/// `messages.batchModify` of any size, so below ten messages separate writes
/// cost less.
pub const SEPARATE_LABEL_WRITES_BELOW: usize = 10;

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxCalendarClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Finds calendar invitation parts in one provider message via a fresh
    /// provider fetch.
    ///
    /// This charges a full message read; ingest paths that already fetched the
    /// message should consume [`MessageWithCalendarParts::calendar_parts`]
    /// instead. This lookup exists for durable re-extraction jobs.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_calendar_parts(
        &self,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Vec<CalendarPart>, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetMessage, |token| async move {
            self.repository
                .get_calendar_parts(&token, provider_message_id)
                .await
        })
        .await
    }
}

#[cfg(test)]
mod test;
