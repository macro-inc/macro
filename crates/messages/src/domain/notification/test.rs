use super::*;
use uuid::Uuid;

fn audience() -> CommentAudience {
    CommentAudience {
        mentioned: vec!["actor".into(), "mentioned".into(), "revoked".into()],
        participants: vec!["mentioned".into(), "participant".into()],
        assignees: vec!["participant".into(), "assignee".into()],
        owners: vec!["mentioned".into(), "owner".into()],
        authorized: ["actor", "mentioned", "participant", "assignee", "owner"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
    }
}

#[test]
fn priority_deduplicates_and_excludes_actor_and_revoked_users() {
    let parent = MessageParent::parse("document", "doc").unwrap();
    let recipients = comment_recipients(&parent, "actor", true, &audience());
    assert_eq!(recipients.len(), 4);
    assert_eq!(recipients["mentioned"], CommentNotificationReason::Mention);
    assert_eq!(recipients["participant"], CommentNotificationReason::Reply);
    assert_eq!(recipients["assignee"], CommentNotificationReason::Assignee);
    assert_eq!(recipients["owner"], CommentNotificationReason::Owner);
    assert!(!recipients.contains_key("actor"));
    assert!(!recipients.contains_key("revoked"));
}

#[test]
fn roots_do_not_notify_participants_and_email_has_no_task_assignees() {
    let parent = MessageParent::EmailThread(Uuid::from_u128(1));
    let recipients = comment_recipients(&parent, "actor", false, &audience());
    assert_eq!(recipients.len(), 2);
    assert_eq!(recipients["mentioned"], CommentNotificationReason::Mention);
    assert_eq!(recipients["owner"], CommentNotificationReason::Owner);
}

#[test]
fn channel_messages_do_not_generate_comment_notifications() {
    let parent = MessageParent::Channel(Uuid::from_u128(1));
    assert!(comment_recipients(&parent, "actor", true, &audience()).is_empty());
}
