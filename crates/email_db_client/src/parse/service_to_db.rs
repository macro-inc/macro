use crate::parse::column_limits;
use chrono::Utc;
use models_email::email::db::{address, attachment};
use models_email::email::service::{message, thread};
use models_email::email::{db, service};
use models_email::service::contact::Contact;
use models_email::service::message::HasContactInfo;
use sqlx::types::Uuid;
use std::mem;

/// Maps a ContactInfo to an EmailAddress, dropping it when the address cannot
/// be stored.
///
/// RFC 5321 caps an address at 254 characters, so anything past the
/// `email_contacts.email_address` column width is tracking-token garbage (the
/// one-click-unsubscribe addresses some senders put in `To:` run to hundreds
/// of characters). Dropping the address is strictly better than failing the
/// whole message insert on it.
fn map_contact_to_db(contact: &service::address::ContactInfo) -> Option<address::EmailAddress> {
    if !column_limits::fits(&contact.email, column_limits::EMAIL_ADDRESS) {
        tracing::warn!(
            length = contact.email.chars().count(),
            limit = column_limits::EMAIL_ADDRESS,
            "dropping unstorable oversized email address"
        );
        return None;
    }

    Some(address::EmailAddress {
        id: macro_uuid::generate_uuid_v7(), // this value doesn't actually matter as we will be setting it later again
        email_address: contact.email.clone(),
        name: column_limits::clamp_opt(
            contact.name.clone(),
            column_limits::CONTACT_NAME,
            "email_contacts.name",
        ),
        created_at: Utc::now(),
    })
}

/// logic for parsing service-layer structs into db-layer structs
pub fn addresses_from_message<T: HasContactInfo>(message: &T) -> address::ParsedAddresses {
    address::ParsedAddresses {
        from: message.get_from().and_then(map_contact_to_db),
        to: message
            .get_to()
            .iter()
            .filter_map(map_contact_to_db)
            .collect(),
        cc: message
            .get_cc()
            .iter()
            .filter_map(map_contact_to_db)
            .collect(),
        bcc: message
            .get_bcc()
            .iter()
            .filter_map(map_contact_to_db)
            .collect(),
    }
}

#[tracing::instrument(skip(service_thread))]
pub fn map_service_thread_to_db(
    service_thread: &thread::Thread,
    link_id: Uuid,
) -> db::thread::Thread {
    db::thread::Thread {
        id: service_thread.db_id,
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
    thread_id: Uuid,
    from_contact_id: Option<Uuid>,
) -> db::message::Message {
    db::message::Message {
        id: service_msg.db_id,
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
        from_name: column_limits::clamp_opt(
            service_msg.from.as_ref().and_then(|f| f.name.clone()),
            column_limits::CONTACT_NAME,
            "email_messages.from_name",
        ),
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
    // store extension in filename as lowercase
    service_attachments
        .iter_mut()
        .map(|service_attachment| {
            let filename = service_attachment.filename.clone().map(|f| {
                if let Some((base, ext)) = f.rsplit_once('.')
                    && !ext.is_empty()
                {
                    return format!("{}.{}", base, ext.to_lowercase());
                }
                f
            });

            attachment::Attachment {
                id: service_attachment.db_id,
                message_id: message_db_id,
                provider_attachment_id: service_attachment.provider_id.clone(),
                filename: column_limits::clamp_opt(
                    filename,
                    column_limits::ATTACHMENT_FILENAME,
                    "email_attachments.filename",
                ),
                mime_type: column_limits::clamp_opt(
                    service_attachment.mime_type.clone(),
                    column_limits::ATTACHMENT_MIME_TYPE,
                    "email_attachments.mime_type",
                ),
                size_bytes: service_attachment.size_bytes,
                content_id: column_limits::clamp_opt(
                    service_attachment.content_id.clone(),
                    column_limits::ATTACHMENT_CONTENT_ID,
                    "email_attachments.content_id",
                ),
                sfs_id: service_attachment.sfs_id,
                created_at: Utc::now(),
            }
        })
        .collect()
}

pub fn map_new_contact_to_db(service_contact: &Contact) -> db::contact::Contact {
    db::contact::Contact {
        id: service_contact.id,
        link_id: service_contact.link_id,
        name: column_limits::clamp_opt(
            service_contact.name.clone(),
            column_limits::CONTACT_NAME,
            "email_contacts.name",
        ),
        email_address: service_contact.email_address.clone(),
        original_photo_url: service_contact.original_photo_url.clone(),
        sfs_photo_url: service_contact.sfs_photo_url.clone(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[cfg(test)]
mod test;
