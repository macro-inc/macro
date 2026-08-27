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
fn macro_staff_gets_all_inbox_new_email_policy() {
    assert_eq!(
        new_email_notify_policy(&id("macro|teo@macro.com")),
        NewEmailNotifyPolicy::AllInbox
    );
}

#[test]
fn macro_staff_plus_alias_gets_all_inbox_new_email_policy() {
    assert_eq!(
        new_email_notify_policy(&id("macro|teo+notify@macro.com")),
        NewEmailNotifyPolicy::AllInbox
    );
}

#[test]
fn customer_gets_signal_only_new_email_policy() {
    assert_eq!(
        new_email_notify_policy(&id("macro|user@example.com")),
        NewEmailNotifyPolicy::SignalOnly
    );
}

#[test]
fn all_inbox_preview_filter_is_thread_only() {
    let thread_id = Uuid::nil();
    match new_email_preview_filter(thread_id, NewEmailNotifyPolicy::AllInbox) {
        Expr::Literal(EmailLiteral::ThreadId(id)) => assert_eq!(id, thread_id),
        other => panic!("expected thread-only filter, got {other:?}"),
    }
}

#[test]
fn signal_only_preview_filter_requires_importance_and_unshared() {
    let thread_id = Uuid::nil();
    match new_email_preview_filter(thread_id, NewEmailNotifyPolicy::SignalOnly) {
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
