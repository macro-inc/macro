use super::*;
use messages::domain::models::MessageParent;

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

#[test]
fn existing_mention_commands_keep_their_wire_shape_and_reply_behavior() {
    let mention = MentionOrigin {
        parent: MessageParent::Channel(Uuid::from_u128(1)),
        thread_id: Uuid::from_u128(2),
        message_id: Uuid::from_u128(3),
        sender: actor(),
        content: "Please review this".to_owned(),
        attachments: vec![PromptAttachment::new("https://example.com/file", "image")],
    };
    let wire = serde_json::to_value(&mention).unwrap();
    let origin: SessionOrigin = serde_json::from_value(wire.clone()).unwrap();
    assert!(matches!(origin, SessionOrigin::Mention(_)));
    assert_eq!(serde_json::to_value(&origin).unwrap(), wire);
    assert!(!origin.announcement().reuse_origin_message);
    assert_eq!(origin.announcement().message_id, mention.message_id);
    assert_eq!(origin.announcement().thread_id, mention.thread_id);
    let AgentAction::Prompt(prompt) = origin.into_action() else {
        panic!("a mention delivers a prompt");
    };
    assert_eq!(prompt.prompt, mention.content);
    assert_eq!(prompt.attachments, mention.attachments);
}

#[test]
fn assignments_remain_distinct_after_command_serialization() {
    let origin = SessionOrigin::TaskAssignment(TaskAssignmentOrigin {
        parent: MessageParent::parse("document", "task-1").unwrap(),
        discussion_id: Uuid::from_u128(4),
        actor: actor(),
        prompt: "Private task brief".to_owned(),
    });
    let wire = serde_json::to_value(&origin).unwrap();
    assert!(wire.get("content").is_none());
    assert!(wire.get("sender").is_none());
    let restored: SessionOrigin = serde_json::from_value(wire).unwrap();
    assert!(matches!(restored, SessionOrigin::TaskAssignment(_)));
    assert_eq!(restored.actor(), &actor());
    assert_eq!(restored.kind(), "task_assignment");
    let announcement = restored.announcement();
    assert!(announcement.reuse_origin_message);
    assert_eq!(announcement.message_id, Uuid::from_u128(4));
    assert_eq!(announcement.thread_id, announcement.message_id);
    let AgentAction::Prompt(prompt) = restored.into_action() else {
        panic!("an assignment delivers its private brief");
    };
    assert_eq!(prompt.prompt, "Private task brief");
}
