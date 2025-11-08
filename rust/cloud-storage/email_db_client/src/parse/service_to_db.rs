use chrono::Utc;
use models_email::email::db::{address, attachment};
use models_email::email::service::{message, thread};
use models_email::email::{db, service};
use models_email::service::contact::Contact;
use models_email::service::message::HasContactInfo;
use sqlx::types::Uuid;
use std::mem;

/// Maps a ContactInfo to an EmailAddress
fn map_contact_to_db(contact: &service::address::ContactInfo) -> address::EmailAddress {
    address::EmailAddress {
        id: macro_uuid::generate_uuid_v7(), // this value doesn't actually matter as we will be setting it later again
        email_address: contact.email.clone(),
        name: contact.name.clone(),
        created_at: Utc::now(),
    }
}

/// logic for parsing service-layer structs into db-layer structs
pub fn addresses_from_message<T: HasContactInfo>(message: &T) -> address::ParsedAddresses {
    address::ParsedAddresses {
        from: message.get_from().map(map_contact_to_db),
        to: message.get_to().iter().map(map_contact_to_db).collect(),
        cc: message.get_cc().iter().map(map_contact_to_db).collect(),
        bcc: message.get_bcc().iter().map(map_contact_to_db).collect(),
    }
}

#[tracing::instrument(skip(service_thread))]
pub fn map_service_thread_to_db(
    service_thread: &thread::Thread,
    id: Uuid,
    link_id: Uuid,
) -> db::thread::Thread {
    db::thread::Thread {
        id,
        provider_id: service_thread.provider_id.clone(),
        link_id,
        inbox_visible: service_thread.inbox_visible,
        is_read: service_thread.is_read,
        latest_inbound_message_ts: service_thread.latest_inbound_message_ts,
        latest_outbound_message_ts: service_thread.latest_outbound_message_ts,
        latest_non_spam_message_ts: service_thread.latest_non_spam_message_ts,
        created_at: service_thread.created_at,
        updated_at: service_thread.updated_at,
    }
}

#[tracing::instrument]
pub fn map_service_message_to_db(
    service_msg: &mut message::Message,
    id: Uuid,
    thread_id: Uuid,
    from_contact_id: Option<Uuid>,
) -> db::message::Message {
    db::message::Message {
        id,
        provider_id: service_msg.provider_id.clone(),
        global_id: service_msg.global_id.clone(),
        thread_id,
        provider_thread_id: service_msg.provider_thread_id.clone(),
        replying_to_id: service_msg.replying_to_id,
        link_id: service_msg.link_id,
        provider_history_id: service_msg.provider_history_id.clone(),
        internal_date_ts: service_msg.internal_date_ts,
        snippet: service_msg.snippet.clone(),
        size_estimate: service_msg.size_estimate,
        subject: service_msg.subject.clone(),
        from_contact_id,
        sent_at: service_msg.sent_at,
        has_attachments: service_msg.has_attachments,
        is_read: service_msg.is_read,
        is_starred: service_msg.is_starred,
        is_sent: service_msg.is_sent,
        is_draft: service_msg.is_draft,
        // these values can be large - move instead of clone
        body_text: mem::take(&mut service_msg.body_text),
        body_html_sanitized: mem::take(&mut service_msg.body_html_sanitized),
        body_macro: mem::take(&mut service_msg.body_macro),
        headers_jsonb: service_msg.headers_json.clone(),
        created_at: service_msg.created_at,
        updated_at: service_msg.updated_at,
    }
}

#[tracing::instrument]
pub fn map_message_to_send_to_db(
    service_msg: &mut message::MessageToSend,
    message_id: Uuid,
    thread_id: Uuid,
) -> db::message::MessageToSend {
    db::message::MessageToSend {
        db_id: Some(message_id),
        provider_id: service_msg.provider_id.clone(),
        provider_thread_id: service_msg.provider_thread_id.clone(),
        replying_to_id: service_msg.replying_to_id,
        thread_db_id: Some(thread_id),
        link_id: service_msg.link_id,
        subject: service_msg.subject.clone(),
        to: service_msg.to.clone(),
        cc: service_msg.cc.clone(),
        bcc: service_msg.bcc.clone(),
        body_text: mem::take(&mut service_msg.body_text),
        body_html: mem::take(&mut service_msg.body_html),
        body_macro: mem::take(&mut service_msg.body_macro),
        headers_json: service_msg.headers_json.clone(),
    }
}

#[tracing::instrument(skip(service_labels))]
pub fn map_service_labels_to_provider_ids(
    service_labels: &[service::label::LabelInfo],
) -> Vec<String> {
    service_labels
        .iter()
        .map(|service_label| service_label.provider_id.clone())
        .collect()
}

#[tracing::instrument(skip(service_attachments))]
pub fn map_service_attachments_to_db(
    service_attachments: &mut [service::attachment::Attachment],
    message_db_id: Uuid,
) -> Vec<attachment::Attachment> {
    service_attachments
        .iter_mut()
        .map(|service_attachment| attachment::Attachment {
            id: macro_uuid::generate_uuid_v7(),
            message_id: message_db_id,
            provider_attachment_id: service_attachment.provider_id.clone(),
            filename: service_attachment.filename.clone(),
            mime_type: service_attachment.mime_type.clone(),
            size_bytes: service_attachment.size_bytes,
            content_id: service_attachment.content_id.clone(),
            created_at: Utc::now(),
        })
        .collect()
}

#[tracing::instrument(skip(service_attachments))]
pub fn map_service_macro_attachments_to_db(
    service_attachments: &mut [service::attachment::AttachmentMacro],
    message_db_id: Uuid,
) -> Vec<attachment::AttachmentMacro> {
    service_attachments
        .iter_mut()
        .map(|service_attachment| attachment::AttachmentMacro {
            id: macro_uuid::generate_uuid_v7(),
            message_id: message_db_id,
            item_id: service_attachment.item_id,
            item_type: service_attachment.item_type.clone(),
            created_at: Utc::now(),
        })
        .collect()
}

pub fn map_new_contact_to_db(service_msg: &Contact, id: Uuid) -> db::contact::Contact {
    db::contact::Contact {
        id,
        link_id: service_msg.link_id,
        name: service_msg.name.clone(),
        email_address: service_msg.email_address.clone(),
        original_photo_url: service_msg.original_photo_url.clone(),
        sfs_photo_url: service_msg.sfs_photo_url.clone(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}
