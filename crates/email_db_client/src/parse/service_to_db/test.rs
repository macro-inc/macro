use super::*;
use models_email::email::service::address::ContactInfo;

/// The shape that wedged mwatts42's backfill: a one-click-unsubscribe `To:`
/// address far past what `email_contacts.email_address` can hold.
fn oversized_address() -> String {
    format!(
        "v3_{}@unsubscribe-06.emailinboundprocessing.com",
        "a".repeat(470)
    )
}

fn contact(email: &str, name: Option<&str>) -> ContactInfo {
    ContactInfo {
        email: email.to_string(),
        name: name.map(str::to_string),
        photo_url: None,
    }
}

fn message_with(from: Option<ContactInfo>, to: Vec<ContactInfo>) -> message::Message {
    let now = Utc::now();
    message::Message {
        db_id: Uuid::now_v7(),
        provider_id: Some("m1".to_string()),
        thread_db_id: Uuid::now_v7(),
        provider_thread_id: Some("t1".to_string()),
        replying_to_id: None,
        global_id: None,
        link_id: Uuid::now_v7(),
        subject: None,
        snippet: None,
        provider_history_id: None,
        internal_date_ts: Some(now),
        sent_at: Some(now),
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: true,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: false,
        from,
        to,
        cc: vec![],
        bcc: vec![],
        labels: vec![],
        body_text: None,
        body_html_sanitized: None,
        body_macro: None,
        attachments: vec![],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: now,
        updated_at: now,
    }
}

#[test]
fn oversized_recipient_addresses_are_dropped_and_the_rest_kept() {
    let message = message_with(
        Some(contact("sender@macro.com", None)),
        vec![
            contact(&oversized_address(), None),
            contact("real@macro.com", None),
        ],
    );

    let addresses = addresses_from_message(&message);

    assert_eq!(addresses.to.len(), 1);
    assert_eq!(addresses.to[0].email_address, "real@macro.com");
    assert!(addresses.from.is_some());
}

#[test]
fn an_address_exactly_at_the_column_width_is_kept() {
    let at_limit = format!(
        "{}@macro.com",
        "a".repeat(column_limits::EMAIL_ADDRESS - 10)
    );
    assert_eq!(at_limit.chars().count(), column_limits::EMAIL_ADDRESS);

    let message = message_with(None, vec![contact(&at_limit, None)]);

    assert_eq!(addresses_from_message(&message).to.len(), 1);
}

#[test]
fn an_oversized_from_address_is_dropped_without_dropping_the_message() {
    let message = message_with(Some(contact(&oversized_address(), Some("Sender"))), vec![]);

    let addresses = addresses_from_message(&message);

    assert!(addresses.from.is_none());
}

#[test]
fn oversized_contact_names_are_truncated() {
    let long_name = "n".repeat(column_limits::CONTACT_NAME + 100);
    let message = message_with(None, vec![contact("real@macro.com", Some(&long_name))]);

    let addresses = addresses_from_message(&message);

    let name = addresses.to[0].name.as_ref().expect("name should survive");
    assert_eq!(name.chars().count(), column_limits::CONTACT_NAME);
}

#[test]
fn oversized_from_names_are_truncated_for_the_message_row() {
    let long_name = "n".repeat(column_limits::CONTACT_NAME + 100);
    let mut message = message_with(Some(contact("sender@macro.com", Some(&long_name))), vec![]);

    let db_message = map_service_message_to_db(&mut message, Uuid::now_v7(), None);

    let from_name = db_message.from_name.expect("from_name should survive");
    assert_eq!(from_name.chars().count(), column_limits::CONTACT_NAME);
}

#[test]
fn oversized_attachment_metadata_is_truncated() {
    let mut attachments = vec![service::attachment::Attachment {
        db_id: Uuid::now_v7(),
        provider_id: Some("a1".to_string()),
        data_url: None,
        filename: Some(format!(
            "{}.PDF",
            "f".repeat(column_limits::ATTACHMENT_FILENAME)
        )),
        mime_type: Some("x".repeat(column_limits::ATTACHMENT_MIME_TYPE + 1)),
        size_bytes: Some(1),
        sfs_id: None,
        content_id: Some("c".repeat(column_limits::ATTACHMENT_CONTENT_ID + 1)),
    }];

    let mapped = map_service_attachments_to_db(&mut attachments, Uuid::now_v7());

    let attachment = &mapped[0];
    assert_eq!(
        attachment.filename.as_ref().unwrap().chars().count(),
        column_limits::ATTACHMENT_FILENAME
    );
    assert_eq!(
        attachment.mime_type.as_ref().unwrap().chars().count(),
        column_limits::ATTACHMENT_MIME_TYPE
    );
    assert_eq!(
        attachment.content_id.as_ref().unwrap().chars().count(),
        column_limits::ATTACHMENT_CONTENT_ID
    );
}

#[test]
fn oversized_synced_contact_names_are_truncated() {
    let contact = Contact {
        id: Uuid::now_v7(),
        link_id: Uuid::now_v7(),
        name: Some("n".repeat(column_limits::CONTACT_NAME + 1)),
        email_address: Some("real@macro.com".to_string()),
        original_photo_url: None,
        sfs_photo_url: None,
    };

    let mapped = map_new_contact_to_db(&contact);

    assert_eq!(
        mapped.name.as_ref().unwrap().chars().count(),
        column_limits::CONTACT_NAME
    );
}
