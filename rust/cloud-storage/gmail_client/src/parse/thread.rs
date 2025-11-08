use anyhow::{Context, Result};
use chrono::Utc;
use futures::future::try_join_all;
use models_email::email::service;
use models_email::email::service::message::{is_inbound, is_outbound, is_spam_or_trash};
use models_email::gmail::ThreadResource;
use models_email::gmail::error::GmailError;
use uuid::Uuid;

use super::message::map_message_resource_to_service;

/// calls map_thread_resource_to_service concurrently on the list of threads
#[tracing::instrument(skip(ordered_responses), level = "debug")]
pub async fn map_thread_resources_to_service(
    ordered_responses: Vec<ThreadResource>,
    link_id: Uuid,
) -> Result<Vec<service::thread::Thread>, GmailError> {
    let mapping_futures = ordered_responses
        .into_iter()
        .map(|r| tokio::spawn(async move { map_thread_resource_to_service(r, link_id).await }))
        .collect::<Vec<_>>();

    let results_from_tasks = try_join_all(mapping_futures)
        .await
        .map_err(|join_error| GmailError::GenericError(join_error.to_string()))?;

    let service_threads: Result<Vec<service::thread::Thread>, _> =
        results_from_tasks.into_iter().collect();

    service_threads.map_err(|mapping_error| GmailError::GenericError(mapping_error.to_string()))
}

#[tracing::instrument(skip(thread_resource), level = "info")]
pub async fn map_thread_resource_to_service(
    thread_resource: ThreadResource,
    link_id: Uuid,
) -> Result<service::thread::Thread> {
    let message_mapping_futures = thread_resource
        .messages
        .into_iter()
        .map(|message| {
            tokio::spawn(async move { map_message_resource_to_service(message, link_id) })
        })
        .collect::<Vec<_>>();

    let results_from_tasks = try_join_all(message_mapping_futures)
        .await
        .map_err(|join_error| {
            anyhow::anyhow!("Task failed during message mapping: {}", join_error)
        })?;

    let mut service_messages: Vec<service::message::Message> = results_from_tasks
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .context("Mapping one or more messages failed")?;

    service_messages.sort_by(|a, b| a.internal_date_ts.cmp(&b.internal_date_ts));

    // if any messages in the thread are in the inbox, the thread is visible in the inbox.
    let inbox_visible = service_messages.iter().any(|msg| {
        msg.labels
            .iter()
            .any(|label| label.provider_label_id == service::label::system_labels::INBOX)
    });

    // if any message in the thread is unread, the thread is considered unread in the FE
    let is_read = !service_messages.iter().any(|msg| !msg.is_read);

    // get the latest timestamp of incoming messages for thread.
    let latest_inbound_message_ts = service_messages
        .iter()
        .filter(|msg| is_inbound(msg))
        .next_back()
        .map(|msg| msg.internal_date_ts)
        .unwrap_or_else(|| None);

    // get the latest timestamp of outgoing messages for thread.
    let latest_outbound_message_ts = service_messages
        .iter()
        .filter(|msg| is_outbound(msg))
        .next_back()
        .map(|msg| msg.internal_date_ts)
        .unwrap_or_else(|| None);

    let latest_non_spam_message_ts = service_messages
        .iter()
        .filter(|msg| !is_spam_or_trash(msg))
        .next_back()
        .map(|msg| msg.internal_date_ts)
        .unwrap_or_else(|| None);

    Ok(service::thread::Thread {
        db_id: None,
        provider_id: Some(thread_resource.id),
        link_id, // From argument
        inbox_visible,
        is_read,
        latest_inbound_message_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
        created_at: Utc::now(), // Omitted - set default/ignored
        updated_at: Utc::now(), // Omitted - set default/ignored
        messages: service_messages,
    })
}
