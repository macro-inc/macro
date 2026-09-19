use super::*;

fn id(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

fn attachment(mime_type: Option<&str>, filename: Option<&str>) -> Attachment {
    Attachment {
        db_id: Uuid::new_v4(),
        provider_id: None,
        data_url: None,
        filename: filename.map(str::to_string),
        mime_type: mime_type.map(str::to_string),
        size_bytes: None,
        sfs_id: None,
        content_id: None,
    }
}

fn assert_attachment_eligibility(attachments: &[Attachment], documents: bool, media: bool) {
    assert_eq!(
        attachment_upload_eligibility(attachments),
        AttachmentUploadEligibility { documents, media }
    );
}

#[test]
fn no_attachments_are_ineligible_for_upload() {
    assert_attachment_eligibility(&[], false, false);
}

#[test]
fn inline_image_only_is_media_eligible() {
    let mut inline_image = attachment(Some("image/png"), Some("signature.png"));
    inline_image.content_id = Some("signature-image".to_string());

    assert_attachment_eligibility(&[inline_image], false, true);
}

#[test]
fn unsupported_and_text_only_parts_are_ineligible_for_upload() {
    let attachments = [
        attachment(Some("application/json"), Some("metadata.json")),
        attachment(Some("text/css"), Some("styles.css")),
    ];

    assert_attachment_eligibility(&attachments, false, false);
}

#[test]
fn document_only_is_document_eligible() {
    let attachments = [attachment(Some("application/pdf"), Some("report.pdf"))];

    assert_attachment_eligibility(&attachments, true, false);
}

#[test]
fn media_only_is_media_eligible() {
    let attachments = [attachment(Some("video/mp4"), Some("recording.mp4"))];

    assert_attachment_eligibility(&attachments, false, true);
}

#[test]
fn mixed_document_and_media_are_both_eligible() {
    let attachments = [
        attachment(Some("application/msword"), Some("report.doc")),
        attachment(Some("image/jpeg"), Some("photo.jpg")),
    ];

    assert_attachment_eligibility(&attachments, true, true);
}

#[test]
fn octet_stream_requires_a_valid_document_extension() {
    let valid = [attachment(
        Some("application/octet-stream"),
        Some("report.final.DoCx"),
    )];
    let invalid = [attachment(
        Some("application/octet-stream"),
        Some("report.pdf.exe"),
    )];

    assert_attachment_eligibility(&valid, true, false);
    assert_attachment_eligibility(&invalid, false, false);
}

#[test]
fn missing_mime_type_matches_neither_category() {
    let attachments = [attachment(None, Some("report.pdf"))];

    assert_attachment_eligibility(&attachments, false, false);
}

#[test]
fn missing_filename_excludes_documents_but_not_media() {
    let document = [attachment(Some("application/pdf"), None)];
    let media = [attachment(Some("image/png"), None)];

    assert_attachment_eligibility(&document, false, false);
    assert_attachment_eligibility(&media, false, true);
}

#[test]
fn includes_owner_and_all_delegated_primaries() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@x.com".to_string(),
            "macro|primary-b@x.com".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([
            owner,
            id("macro|primary-a@x.com"),
            id("macro|primary-b@x.com"),
        ])
    );
}

#[test]
fn returns_only_owner_when_no_primaries() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(&owner, vec![]);

    assert_eq!(recipients, HashSet::from([owner]));
}

#[test]
fn skips_unparseable_primaries_keeping_valid_ones() {
    let owner = id("macro|owner@x.com");
    let recipients = build_notification_recipients(
        &owner,
        vec![
            "macro|primary-a@x.com".to_string(),
            "not-a-valid-id".to_string(),
        ],
    );

    assert_eq!(
        recipients,
        HashSet::from([owner, id("macro|primary-a@x.com")])
    );
}

#[test]
fn selects_draft_sync_for_new_draft() {
    assert_eq!(
        select_message_sync_event(None, true, false),
        Some(MessageSyncEventKind::DraftSynced)
    );
}

#[test]
fn selects_draft_sync_for_draft_edit() {
    assert_eq!(
        select_message_sync_event(Some(true), true, false),
        Some(MessageSyncEventKind::DraftSynced)
    );
}

#[test]
fn selects_sent_for_provider_draft_to_sent_transition() {
    assert_eq!(
        select_message_sync_event(Some(true), false, true),
        Some(MessageSyncEventKind::Sent)
    );
}

#[test]
fn selects_sent_for_new_sent_message() {
    assert_eq!(
        select_message_sync_event(None, false, true),
        Some(MessageSyncEventKind::Sent)
    );
}

#[test]
fn selects_received_for_new_received_message() {
    assert_eq!(
        select_message_sync_event(None, false, false),
        Some(MessageSyncEventKind::Received)
    );
}

#[test]
fn suppresses_existing_immutable_non_drafts() {
    assert_eq!(select_message_sync_event(Some(false), false, false), None);
    assert_eq!(select_message_sync_event(Some(false), false, true), None);
}

#[test]
fn staff_recipients_are_split_onto_the_apns_path() {
    let (staff, customers) = partition_email_push_recipients(HashSet::from([
        id("macro|teo@macro.com"),
        id("macro|teo+notify@macro.com"),
        id("macro|user@example.com"),
    ]));

    assert_eq!(
        staff,
        HashSet::from([id("macro|teo@macro.com"), id("macro|teo+notify@macro.com"),])
    );
    assert_eq!(customers, HashSet::from([id("macro|user@example.com")]));
}

#[test]
fn customer_only_recipients_do_not_take_the_apns_path() {
    let (staff, customers) =
        partition_email_push_recipients(HashSet::from([id("macro|user@example.com")]));

    assert!(staff.is_empty());
    assert_eq!(customers, HashSet::from([id("macro|user@example.com")]));
}

fn email_notification_builder(
    recipient: &str,
) -> SendNotificationRequestBuilder<'static, NewEmailMetadata> {
    SendNotificationRequestBuilder {
        notification_entity: EntityType::EmailThread.with_entity_string(Uuid::nil().to_string()),
        secondary_notification_entity: None,
        notification: NewEmailMetadata {
            sender: Some("Sender".to_string()),
            to_email: "staff@macro.com".to_string(),
            thread_id: Uuid::nil().to_string(),
            subject: "Subject".to_string(),
            snippet: "Snippet".to_string(),
        },
        sender_id: Some(id("macro|sender@example.com")),
        recipient_ids: HashSet::from([id(recipient)]),
    }
}

#[test]
fn noise_requests_preserve_rows_without_realtime_delivery() {
    // A staff inbox may also notify a non-staff delegate. Neither recipient
    // partition should receive GraphQL/gateway events for the Noise tier.
    for recipient in ["macro|staff@macro.com", "macro|delegate@example.com"] {
        let builder = email_notification_builder(recipient);
        let original = serde_json::to_value(&builder).unwrap();
        let request = NewEmailTier::StaffInbox.notification_request(builder);
        let request = serde_json::to_value(request).unwrap();

        assert_eq!(request["send_conn_gateway"], false);
        assert!(request["build_apns"].is_null());
        assert!(request["build_email"].is_null());
        assert!(request["uuid_to_write"].is_string());
        for field in [
            "notification_entity",
            "secondary_notification_entity",
            "sender_id",
            "recipient_ids",
        ] {
            assert_eq!(request["req"][field], original[field]);
        }
        assert_eq!(request["req"]["notification"]["tag"], "new_email");
        assert_eq!(
            request["req"]["notification"]["content"],
            original["notification"]
        );
    }
}

#[test]
fn signal_requests_keep_realtime_delivery_for_both_recipient_partitions() {
    for recipient in ["macro|staff@macro.com", "macro|customer@example.com"] {
        let request =
            NewEmailTier::Signal.notification_request(email_notification_builder(recipient));
        let request = serde_json::to_value(request).unwrap();

        assert_eq!(request["send_conn_gateway"], true);
        // The staff branch adds APNS separately; customer requests stay realtime-only.
        assert!(request["build_apns"].is_null());
    }
}

#[test]
fn signal_staff_requests_keep_apns_and_realtime_delivery() {
    let request = NewEmailTier::Signal
        .notification_request(email_notification_builder("macro|staff@macro.com"))
        .with_apns();
    let request = serde_json::to_value(request).unwrap();

    assert_eq!(request["send_conn_gateway"], true);
    assert!(request["build_apns"].is_object());
}

#[test]
fn signal_filter_requires_importance_and_unshared() {
    let thread_id = Uuid::nil();
    match signal_filter(thread_id) {
        Expr::And(thread, rest) => {
            assert!(matches!(
                *thread,
                Expr::Literal(EmailLiteral::ThreadId(id)) if id == thread_id
            ));
            match *rest {
                Expr::And(importance, shared) => {
                    assert!(matches!(
                        *importance,
                        Expr::Literal(EmailLiteral::Importance(true))
                    ));
                    assert!(matches!(
                        *shared,
                        Expr::Literal(EmailLiteral::Shared(SharedEmailFilter::Exclude))
                    ));
                }
                other => panic!("expected importance AND shared, got {other:?}"),
            }
        }
        other => panic!("expected thread AND signal predicates, got {other:?}"),
    }
}
