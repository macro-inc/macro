//! Reconstruct approved GraphQL delivery without consulting mutable message content.

use email::domain::send_attempt::{PreparedSendContent, PreparedSendContentUnavailable};
use email_db_client::messages::scheduled::delivery::DeliveryClaim;
use models_email::service::{address::ContactInfo, message::MessageToSend};
use sqlx::PgPool;

pub(super) async fn load_delivery_content(
    db: &PgPool,
    claim: &DeliveryClaim,
) -> anyhow::Result<(MessageToSend, ContactInfo)> {
    if claim.approved_snapshot.is_none() {
        return email_db_client::messages::get::get_message_to_send(
            db,
            claim.schedule.message_id,
            claim.schedule.link_id,
        )
        .await;
    }
    let content = claim
        .prepared_content
        .as_ref()
        .ok_or(PreparedSendContentUnavailable)?;
    let content: PreparedSendContent =
        serde_json::from_value(content.clone()).map_err(|_| PreparedSendContentUnavailable)?;
    if content.message.db_id != claim.schedule.message_id {
        return Err(PreparedSendContentUnavailable.into());
    }
    let message = content.message;
    Ok((
        MessageToSend {
            db_id: Some(message.db_id),
            provider_id: message.provider_id,
            replying_to_id: message.replying_to_id,
            provider_thread_id: message.provider_thread_id,
            thread_db_id: Some(message.thread_db_id),
            link_id: claim.schedule.link_id,
            subject: message.subject,
            to: Some(message.to.into_iter().map(contact).collect()),
            cc: Some(message.cc.into_iter().map(contact).collect()),
            bcc: Some(message.bcc.into_iter().map(contact).collect()),
            body_text: message.body_text,
            body_html: message.body_html,
            body_macro: message.body_macro,
            attachments: None,
            headers_json: message.headers_json,
            send_time: message.send_time,
        },
        contact(content.sender),
    ))
}

fn contact(value: email::domain::models::ContactInfo) -> ContactInfo {
    ContactInfo {
        email: value.email,
        name: value.name,
        photo_url: value.photo_url,
    }
}

#[cfg(test)]
mod test;
