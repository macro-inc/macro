use crate::domain::models::{
    AttachmentDraft, AttachmentForwarded, ContactInfo, Message, MessageAttachment, MessageLabel,
    MessageRow, RecipientType, Thread, ThreadRow,
};

pub fn split_recipients(
    recipients: Vec<(ContactInfo, RecipientType)>,
) -> (Vec<ContactInfo>, Vec<ContactInfo>, Vec<ContactInfo>) {
    let mut to = Vec::new();
    let mut cc = Vec::new();
    let mut bcc = Vec::new();
    for (contact, r_type) in recipients {
        match r_type {
            RecipientType::To => to.push(contact),
            RecipientType::Cc => cc.push(contact),
            RecipientType::Bcc => bcc.push(contact),
        }
    }
    (to, cc, bcc)
}

#[allow(clippy::too_many_arguments)]
pub fn message_from_row(
    row: MessageRow,
    from: Option<ContactInfo>,
    to: Vec<ContactInfo>,
    cc: Vec<ContactInfo>,
    bcc: Vec<ContactInfo>,
    labels: Vec<MessageLabel>,
    attachments: Vec<MessageAttachment>,
    attachments_draft: Vec<AttachmentDraft>,
    attachments_forwarded: Vec<AttachmentForwarded>,
    scheduled_send_time: Option<chrono::DateTime<chrono::Utc>>,
    body_replyless: Option<String>,
) -> Message {
    Message {
        db_id: row.db_id,
        provider_id: row.provider_id,
        thread_db_id: row.thread_db_id,
        provider_thread_id: row.provider_thread_id,
        replying_to_id: row.replying_to_id,
        global_id: row.global_id,
        link_id: row.link_id,
        subject: row.subject,
        snippet: row.snippet,
        provider_history_id: row.provider_history_id,
        internal_date_ts: row.internal_date_ts,
        sent_at: row.sent_at,
        size_estimate: row.size_estimate,
        is_read: row.is_read,
        is_starred: row.is_starred,
        is_sent: row.is_sent,
        is_draft: row.is_draft,
        has_attachments: row.has_attachments,
        scheduled_send_time,
        from,
        to,
        cc,
        bcc,
        labels,
        body_text: row.body_text,
        body_html_sanitized: row.body_html_sanitized,
        body_macro: row.body_macro,
        body_replyless,
        attachments,
        attachments_draft,
        attachments_forwarded,
        headers_json: row.headers_json,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

pub fn thread_from_row(row: ThreadRow, messages: Vec<Message>) -> Thread {
    Thread { row, messages }
}
