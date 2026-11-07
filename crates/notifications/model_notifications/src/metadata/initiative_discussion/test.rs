use super::*;

#[test]
fn project_notifications_keep_canonical_message_targets_and_project_wording() {
    let message_id = Uuid::from_u128(1);
    let thread_id = Uuid::from_u128(2);
    for (reason, title) in [
        (
            InitiativeDiscussionReason::Mention,
            "Planner mentioned you in Launch",
        ),
        (
            InitiativeDiscussionReason::Reply,
            "Planner replied in Launch",
        ),
        (
            InitiativeDiscussionReason::Assignee,
            "Planner commented on Launch",
        ),
        (
            InitiativeDiscussionReason::Owner,
            "Planner commented on Launch",
        ),
    ] {
        let metadata = InitiativeDiscussionMetadata {
            project_name: "Launch".into(),
            owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
            reason,
            message_id,
            thread_id,
            text: "Ready for review".into(),
            sender_display_name: Some("Planner".into()),
            sender_profile_picture_url: None,
        };
        assert_eq!(metadata.format_title(None).unwrap(), title);
        assert_eq!(metadata.format_body(None).unwrap(), "Ready for review");
        let encoded =
            serde_json::to_value(crate::NotifEvent::InitiativeDiscussion(metadata)).unwrap();
        assert_eq!(encoded["tag"], "initiative_discussion");
        assert_eq!(encoded["content"]["messageId"], message_id.to_string());
        assert_eq!(encoded["content"]["threadId"], thread_id.to_string());
        assert!(matches!(
            serde_json::from_value::<crate::NotifEvent>(encoded).unwrap(),
            crate::NotifEvent::InitiativeDiscussion(_)
        ));
    }
}
