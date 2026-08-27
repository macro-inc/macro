//! Gmail message capability implementation.

use base64::{
    Engine as _,
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
};
use models_email::email::service::message::Message;
use models_email::email::service::thread::ThreadSummary;
use models_email::gmail::MessagePart;
use uuid::Uuid;

use crate::domain::models::{
    AccessToken, CalendarPart, EmailApiError, MessageWithCalendarParts, ThreadListPage,
};
use crate::domain::ports::{MailboxCalendarClient, MailboxMessageClient};

use super::convert::{map_message_resource_to_service, map_thread_resource_to_service};
use super::{GmailApiClientRepository, map_gmail_error};

impl MailboxCalendarClient for GmailApiClientRepository {
    async fn get_calendar_parts(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
    ) -> Result<Vec<CalendarPart>, EmailApiError> {
        let Some(message) = self
            .client
            .get_message(access_token.expose_secret(), provider_message_id)
            .await
            .map_err(map_gmail_error)?
        else {
            return Ok(Vec::new());
        };

        collect_calendar_parts(&message.payload)
    }
}

fn collect_calendar_parts(root: &MessagePart) -> Result<Vec<CalendarPart>, EmailApiError> {
    let mut result = Vec::new();
    let mut stack = vec![root];
    while let Some(part) = stack.pop() {
        let mime_type = part.mime_type.split(';').next().unwrap_or_default().trim();
        let is_calendar = mime_type.eq_ignore_ascii_case("text/calendar")
            || mime_type.eq_ignore_ascii_case("application/ics")
            || part.filename.to_ascii_lowercase().ends_with(".ics");
        if is_calendar {
            let body = part.body.as_ref();
            let inline_data =
                body.and_then(|body| body.data_base64.as_deref())
                    .and_then(|encoded| {
                        URL_SAFE_NO_PAD
                            .decode(encoded)
                            .or_else(|_| URL_SAFE.decode(encoded))
                            .ok()
                    });
            result.push(CalendarPart {
                part_id: (!part.part_id.is_empty()).then(|| part.part_id.clone()),
                filename: (!part.filename.is_empty()).then(|| part.filename.clone()),
                mime_type: part.mime_type.clone(),
                inline_data,
                provider_attachment_id: body.and_then(|body| body.attachment_id.clone()),
            });
        }
        if let Some(children) = &part.parts {
            stack.extend(children);
        }
    }
    Ok(result)
}

impl MailboxMessageClient for GmailApiClientRepository {
    async fn get_message(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        provider_message_id: &str,
    ) -> Result<Option<MessageWithCalendarParts>, EmailApiError> {
        let Some(resource) = self
            .client
            .get_message(access_token.expose_secret(), provider_message_id)
            .await
            .map_err(map_gmail_error)?
        else {
            return Ok(None);
        };

        // Extract calendar parts from the wire resource we already hold so
        // ingest never needs a second messages.get for the same message.
        let calendar_parts = collect_calendar_parts(&resource.payload)?;
        let message = map_message_resource_to_service(resource, link_id)?;

        Ok(Some(MessageWithCalendarParts {
            message,
            calendar_parts,
        }))
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
