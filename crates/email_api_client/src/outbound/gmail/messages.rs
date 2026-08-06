//! Gmail message capability implementation.

use models_email::email::service::message::Message;
use models_email::email::service::thread::ThreadSummary;
use uuid::Uuid;

use crate::domain::models::{AccessToken, EmailApiError, ThreadListPage};
use crate::domain::ports::MailboxMessageClient;

use super::convert::{map_message_resource_to_service, map_thread_resource_to_service};
use super::{GmailApiClientRepository, map_gmail_error};

impl MailboxMessageClient for GmailApiClientRepository {
    async fn get_message(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Option<Message>, EmailApiError> {
        self.client
            .get_message(access_token.expose_secret(), provider_message_id)
            .await
            .map_err(map_gmail_error)?
            .map(|message| map_message_resource_to_service(message, link_id))
            .transpose()
    }

    async fn get_message_label_ids(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        self.client
            .get_message_label_ids(access_token.expose_secret(), provider_message_id)
            .await
            .map_err(map_gmail_error)
    }

    async fn list_messages(
        &self,
        access_token: &AccessToken,
        limit: u32,
        label_ids: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        self.client
            .list_messages(access_token.expose_secret(), limit, label_ids)
            .await
            .map_err(map_gmail_error)
    }

    async fn get_message_ids_for_thread(
        &self,
        access_token: &AccessToken,
        provider_thread_id: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        self.client
            .get_message_ids_for_thread(access_token.expose_secret(), provider_thread_id)
            .await
            .map_err(map_gmail_error)
    }

    async fn get_thread(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> Result<Vec<Message>, EmailApiError> {
        let resource = self
            .client
            .get_thread(access_token.expose_secret(), provider_thread_id)
            .await
            .map_err(map_gmail_error)?;
        Ok(map_thread_resource_to_service(resource, link_id)?.messages)
    }

    async fn list_threads(
        &self,
        access_token: &AccessToken,
        limit: u32,
        next_page_token: Option<&str>,
        label_ids: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        let response = self
            .client
            .list_threads(
                access_token.expose_secret(),
                limit,
                next_page_token,
                label_ids,
            )
            .await
            .map_err(map_gmail_error)?;
        Ok(ThreadListPage {
            threads: response
                .threads
                .unwrap_or_default()
                .into_iter()
                .map(|thread| ThreadSummary {
                    provider_id: thread.id,
                })
                .collect(),
            next_page_token: response.next_page_token,
        })
    }

    async fn modify_message_labels(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
        label_ids_to_add: &[String],
        label_ids_to_remove: &[String],
    ) -> Result<(), EmailApiError> {
        self.client
            .modify_message_labels(
                access_token.expose_secret(),
                provider_message_id,
                label_ids_to_add,
                label_ids_to_remove,
            )
            .await
            .map_err(map_gmail_error)
    }
}
