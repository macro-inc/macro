use models_email::email::db::attachment;
use models_email::email::service::{message, thread};
use models_email::email::{db, service};
use models_email::service::message::MessageToSend;

/// logic for parsing db-layer structs into service-layer structs

#[tracing::instrument]
pub fn map_db_contact_to_service(
    db_sender: Option<db::contact::Contact>,
) -> Option<service::address::ContactInfo> {
    db_sender.map(|db| service::address::ContactInfo {
        email: db.email_address.unwrap_or_default(),
        name: db.name,
        photo_url: db.sfs_photo_url,
    })
}

#[tracing::instrument]
pub fn map_db_recipients_to_service(
    db_recipients: Vec<(db::contact::Contact, db::address::EmailRecipientType)>,
) -> (
    Vec<service::address::ContactInfo>,
    Vec<service::address::ContactInfo>,
    Vec<service::address::ContactInfo>,
) {
    let mut to_list = Vec::new();
    let mut cc_list = Vec::new();
    let mut bcc_list = Vec::new();

    for (db_addr, recip_type) in db_recipients {
        let contact = service::address::ContactInfo {
            email: db_addr.email_address.unwrap_or_default(),
            name: db_addr.name,
            photo_url: db_addr.sfs_photo_url,
        };
        match recip_type {
            db::address::EmailRecipientType::To => to_list.push(contact),
            db::address::EmailRecipientType::Cc => cc_list.push(contact),
            db::address::EmailRecipientType::Bcc => bcc_list.push(contact),
        }
    }
    (to_list, cc_list, bcc_list)
}

#[tracing::instrument]
pub fn map_db_labels_to_service(
    db_labels: Vec<db::label::Label>,
) -> Vec<service::label::LabelInfo> {
    db_labels
        .into_iter()
        .map(|db_label| service::label::LabelInfo {
            provider_id: db_label.provider_label_id,
            name: db_label.name,
        })
        .collect()
}

#[tracing::instrument]
pub fn map_db_attachments_to_service(
    db_attachments: Vec<attachment::Attachment>,
) -> Vec<service::attachment::Attachment> {
    db_attachments
        .into_iter()
        .map(map_db_attachment_to_service)
        .collect()
}

#[tracing::instrument]
pub fn map_db_attachment_to_service(
    db_att: db::attachment::Attachment,
) -> service::attachment::Attachment {
    service::attachment::Attachment {
        db_id: Some(db_att.id),
        provider_id: db_att.provider_attachment_id,
        data_url: None,
        filename: db_att.filename,
        mime_type: db_att.mime_type,
        size_bytes: db_att.size_bytes,
        content_id: db_att.content_id,
    }
}

#[tracing::instrument]
pub fn map_db_macro_attachments_to_service(
    db_attachments: Vec<attachment::AttachmentMacro>,
) -> Vec<service::attachment::AttachmentMacro> {
    db_attachments
        .into_iter()
        .map(map_db_macro_attachment_to_service)
        .collect()
}

#[tracing::instrument]
pub fn map_db_macro_attachment_to_service(
    db_att: db::attachment::AttachmentMacro,
) -> service::attachment::AttachmentMacro {
    service::attachment::AttachmentMacro {
        db_id: Some(db_att.id),
        message_id: Some(db_att.message_id),
        item_type: db_att.item_type,
        item_id: db_att.item_id,
    }
}

#[tracing::instrument(skip(db_message, sender_res, recipients_res, labels_res, attachments_res,))]
pub fn map_db_message_to_service(
    db_message: db::message::Message,
    sender_res: Option<db::contact::Contact>,
    recipients_res: Vec<(db::contact::Contact, db::address::EmailRecipientType)>,
    scheduled_res: Option<db::message::ScheduledMessage>,
    labels_res: Vec<db::label::Label>,
    attachments_res: Vec<attachment::Attachment>,
    macro_attachments_res: Vec<attachment::AttachmentMacro>,
) -> anyhow::Result<message::Message> {
    let mut service_message = map_attachmentless_db_message_to_service(
        db_message,
        sender_res,
        recipients_res,
        scheduled_res,
        labels_res,
    );

    service_message.attachments = map_db_attachments_to_service(attachments_res);

    service_message.attachments_macro = map_db_macro_attachments_to_service(macro_attachments_res);

    Ok(service_message)
}

#[tracing::instrument(skip(db_message, recipients_res))]
pub fn map_db_message_to_message_to_send(
    db_message: db::message::Message,
    recipients_res: Vec<(db::contact::Contact, db::address::EmailRecipientType)>,
) -> message::MessageToSend {
    let (to_list, cc_list, bcc_list) = map_db_recipients_to_service(recipients_res);

    MessageToSend {
        db_id: Some(db_message.id),
        provider_id: db_message.provider_id,
        replying_to_id: db_message.replying_to_id,
        provider_thread_id: db_message.provider_thread_id,
        thread_db_id: Some(db_message.thread_id),
        link_id: db_message.link_id,
        subject: db_message.subject.unwrap_or_default(),
        to: if to_list.is_empty() {
            None
        } else {
            Some(to_list)
        },
        cc: if cc_list.is_empty() {
            None
        } else {
            Some(cc_list)
        },
        bcc: if bcc_list.is_empty() {
            None
        } else {
            Some(bcc_list)
        },
        body_text: db_message.body_text,
        body_html: db_message.body_html_sanitized,
        body_macro: db_message.body_macro,
        // we don't currently support sending attachments - they get converted to macro.com links on the FE before sending
        attachments: None,
        attachments_macro: None,
        headers_json: db_message.headers_jsonb,
        send_time: None,
    }
}

// Maps the db layer message object to the service layer message object, without attachments. Kept
// separate so we don't have to pass in an s3 client for generating the attachment data urls if we
// don't need to (ex. when fetching thread metadata)
#[tracing::instrument(skip(db_message, sender_res, recipients_res, labels_res))]
pub fn map_attachmentless_db_message_to_service(
    db_message: db::message::Message, // Take ownership of the base message data
    sender_res: Option<db::contact::Contact>,
    recipients_res: Vec<(db::contact::Contact, db::address::EmailRecipientType)>,
    scheduled_res: Option<db::message::ScheduledMessage>,
    labels_res: Vec<db::label::Label>,
) -> message::Message {
    let sender_info = map_db_contact_to_service(sender_res);
    let (to_list, cc_list, bcc_list) = map_db_recipients_to_service(recipients_res);
    let labels_list = labels_res.into_iter().map(Into::into).collect();

    message::Message {
        db_id: Some(db_message.id),
        provider_id: db_message.provider_id,
        provider_thread_id: db_message.provider_thread_id,
        thread_db_id: Some(db_message.thread_id),
        replying_to_id: db_message.replying_to_id,
        global_id: db_message.global_id,
        link_id: db_message.link_id,
        subject: db_message.subject,
        snippet: db_message.snippet,
        provider_history_id: db_message.provider_history_id,
        internal_date_ts: db_message.internal_date_ts,
        sent_at: db_message.sent_at,
        size_estimate: db_message.size_estimate,
        is_read: db_message.is_read,
        is_starred: db_message.is_starred,
        is_sent: db_message.is_sent,
        is_draft: db_message.is_draft,
        scheduled_send_time: scheduled_res.map(|scheduled| scheduled.send_time),
        has_attachments: db_message.has_attachments,
        from: sender_info,
        to: to_list,
        cc: cc_list,
        bcc: bcc_list,
        labels: labels_list,
        body_text: db_message.body_text,
        body_html_sanitized: db_message.body_html_sanitized,
        body_macro: db_message.body_macro,
        attachments: Vec::new(),
        attachments_macro: Vec::new(),
        headers_json: db_message.headers_jsonb,
        created_at: db_message.created_at,
        updated_at: db_message.updated_at,
    }
}

/// Maps to a simplified version of message that has no nested fields (contacts, labels, attachments). Direct
/// map from the db::message::Message object, but with no body attributes.
pub fn map_db_message_to_simple_message(
    db_message: db::message::Message,
) -> message::SimpleMessage {
    message::SimpleMessage {
        db_id: db_message.id,
        provider_id: db_message.provider_id,
        // should always have global_id set since we are fetching from database
        global_id: db_message.global_id.unwrap_or_default(),
        thread_db_id: db_message.thread_id,
        provider_thread_id: db_message.provider_thread_id,
        replying_to_id: db_message.replying_to_id,
        link_id: db_message.link_id,
        subject: db_message.subject,
        snippet: db_message.snippet,
        from_contact_id: db_message.from_contact_id,
        provider_history_id: db_message.provider_history_id,
        internal_date_ts: db_message.internal_date_ts,
        sent_at: db_message.sent_at,
        size_estimate: db_message.size_estimate,
        is_read: db_message.is_read,
        is_starred: db_message.is_starred,
        is_sent: db_message.is_sent,
        is_draft: db_message.is_draft,
        has_attachments: db_message.has_attachments,
        headers_json: db_message.headers_jsonb,
        created_at: db_message.created_at,
        updated_at: db_message.updated_at,
    }
}

#[tracing::instrument(skip(db_thread, messages))]
pub fn map_db_thread_to_service(
    db_thread: db::thread::Thread,
    messages: Vec<message::Message>,
) -> thread::Thread {
    thread::Thread {
        db_id: Some(db_thread.id),
        provider_id: db_thread.provider_id,
        link_id: db_thread.link_id,
        inbox_visible: db_thread.inbox_visible,
        is_read: db_thread.is_read,
        latest_inbound_message_ts: db_thread.latest_inbound_message_ts,
        latest_outbound_message_ts: db_thread.latest_outbound_message_ts,
        latest_non_spam_message_ts: db_thread.latest_non_spam_message_ts,
        created_at: db_thread.created_at,
        updated_at: db_thread.updated_at,
        messages, // Use the already mapped messages
    }
}
