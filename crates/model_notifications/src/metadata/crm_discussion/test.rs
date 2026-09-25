use super::*;

#[test]
fn crm_notifications_keep_canonical_message_targets_and_record_wording() {
    let message_id = Uuid::from_u128(1);
    let thread_id = Uuid::from_u128(2);
    for (reason, title) in [
        (CrmDiscussionReason::Mention, "Seller mentioned you in Acme"),
        (CrmDiscussionReason::Reply, "Seller replied in Acme"),
        (CrmDiscussionReason::Owner, "Seller commented on Acme"),
    ] {
        let metadata = CrmDiscussionMetadata {
            record_name: "Acme".into(),
            reason,
            message_id,
            thread_id,
            text: "Renewal is on track".into(),
            sender_display_name: Some("Seller".into()),
            sender_profile_picture_url: None,
        };
        assert_eq!(metadata.format_title(None).unwrap(), title);
        assert_eq!(metadata.format_body(None).unwrap(), "Renewal is on track");
        let encoded = serde_json::to_value(crate::NotifEvent::CrmDiscussion(metadata)).unwrap();
        assert_eq!(encoded["tag"], "crm_discussion");
        assert_eq!(encoded["content"]["messageId"], message_id.to_string());
        assert_eq!(encoded["content"]["threadId"], thread_id.to_string());
        assert!(matches!(
            serde_json::from_value::<crate::NotifEvent>(encoded).unwrap(),
            crate::NotifEvent::CrmDiscussion(_)
        ));
    }
}
