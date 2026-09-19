use chrono::Utc;
use models_email::email::service;
use models_email::email::service::message::{is_inbound, is_outbound, is_spam_or_trash};
use models_email::gmail::ThreadResource;
use uuid::Uuid;

use super::message::map_message_resource_to_service;
use crate::domain::models::EmailApiError;

pub(crate) fn map_thread_resource_to_service(
    resource: ThreadResource,
    link_id: Uuid,
) -> Result<service::thread::Thread, EmailApiError> {
    // Accepted trade-off: messages convert sequentially (main spawned a task
    // per message). Conversion is dominated by ammonia sanitization, which is
    // fast relative to the surrounding provider fetch; if profiling ever shows
    // large threads stalling runtime workers, batch the conversions through
    // spawn_blocking rather than reintroducing spawn-per-message.
    let mut messages = resource
        .messages
        .into_iter()
        .map(|message| map_message_resource_to_service(message, link_id))
        .collect::<Result<Vec<_>, _>>()?;
    messages.sort_by_key(|message| message.internal_date_ts);

    let inbox_visible = messages.iter().any(|message| {
        message
            .labels
            .iter()
            .any(|label| label.provider_label_id == service::label::system_labels::INBOX)
    });
    let is_read = messages.iter().all(|message| message.is_read);
    let latest_inbound_message_ts = messages
        .iter()
        .rfind(|message| is_inbound(message))
        .and_then(|message| message.internal_date_ts);
    let latest_outbound_message_ts = messages
        .iter()
        .rfind(|message| is_outbound(message))
        .and_then(|message| message.internal_date_ts);
    let latest_non_spam_message_ts = messages
        .iter()
        .rfind(|message| !is_spam_or_trash(message))
        .and_then(|message| message.internal_date_ts);

    let thread_db_id = Uuid::now_v7();
    for message in &mut messages {
        message.thread_db_id = thread_db_id;
    }

    Ok(service::thread::Thread {
        db_id: thread_db_id,
        provider_id: Some(resource.id),
        link_id,
        inbox_visible,
        is_read,
        latest_inbound_message_ts,
        latest_outbound_message_ts,
        latest_non_spam_message_ts,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        messages,
    })
}

#[cfg(test)]
mod test;
