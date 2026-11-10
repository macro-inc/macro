use chrono::{DateTime, Utc};
use serde_json::json;
use uuid::Uuid;

use super::*;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn stack(id: u128, capture: Vec<StackRule>, release: Vec<StackRule>) -> NotificationStack {
    NotificationStack {
        id: Uuid::from_u128(id),
        name: "Support channels".to_string(),
        position: 0,
        lane: NotificationLane::Noise,
        capture,
        release,
        enabled: true,
        revision: 4,
        created_at: DateTime::<Utc>::UNIX_EPOCH,
        updated_at: DateTime::<Utc>::UNIX_EPOCH,
    }
}

fn in_channel(kind: StackKind, name: &str, channel_type: ChannelType) -> Conversation {
    Conversation {
        kind,
        place: Place::Channel {
            id: "channel-1".to_string(),
            name: name.to_string(),
            channel_type,
        },
        sender: Some(user("sam@example.com")),
    }
}

fn on_document(kind: StackKind, placement: DocumentPlacement) -> Conversation {
    Conversation {
        kind,
        place: Place::Document {
            id: "document-1".to_string(),
            is_task: true,
            placement,
        },
        sender: Some(user("sam@example.com")),
    }
}

fn kinds(kinds: &[StackKind]) -> StackRule {
    StackRule {
        kinds: kinds.to_vec(),
        ..Default::default()
    }
}

fn from(source: StackSource) -> StackRule {
    StackRule {
        sources: vec![source],
        ..Default::default()
    }
}

/// The stack this feature was built for: capture every support channel,
/// release mentions and replies in my threads.
fn support_stack() -> NotificationStack {
    stack(
        1,
        vec![from(StackSource::ChannelNameContains {
            text: "macro support".to_string(),
        })],
        vec![kinds(&[StackKind::Mention]), kinds(&[StackKind::Reply])],
    )
}

#[test]
fn the_support_stack_captures_messages_and_releases_mentions_and_replies() {
    let stacks = [support_stack()];
    let support = |kind| in_channel(kind, "Macro Support: Acme", ChannelType::Private);

    let message = support(StackKind::NewMessage).route(&stacks).unwrap();
    assert_eq!(message.lane, NotificationLane::Noise);
    assert_eq!(
        message.record,
        RoutingRecord {
            stack_id: Uuid::from_u128(1),
            stack_revision: 4,
            outcome: RoutingOutcome::Captured,
            capture_rule: 0,
            release_rule: None,
        }
    );

    let reaction = support(StackKind::Reaction).route(&stacks).unwrap();
    assert_eq!(reaction.record.outcome, RoutingOutcome::Captured);

    let mention = support(StackKind::Mention).route(&stacks).unwrap();
    assert_eq!(mention.lane, NotificationLane::Signal);
    assert_eq!(mention.record.outcome, RoutingOutcome::Released);
    assert_eq!(mention.record.release_rule, Some(0));

    let reply = support(StackKind::Reply).route(&stacks).unwrap();
    assert_eq!(reply.lane, NotificationLane::Signal);
    assert_eq!(reply.record.release_rule, Some(1));

    let elsewhere = in_channel(StackKind::NewMessage, "General", ChannelType::Public);
    assert_eq!(elsewhere.route(&stacks), None);
}

#[test]
fn a_channel_name_never_matches_a_direct_message() {
    let stacks = [support_stack()];

    // A direct message is named after the other person, who may be called
    // anything.
    let direct = in_channel(
        StackKind::NewMessage,
        "Macro Support",
        ChannelType::DirectMessage,
    );

    assert_eq!(direct.route(&stacks), None);
}

#[test]
fn a_rule_needs_every_condition_it_sets() {
    let rule = StackRule {
        sources: vec![StackSource::Channel {
            id: "channel-1".to_string(),
        }],
        channel_types: vec![ChannelType::Team],
        kinds: vec![StackKind::Reaction],
        senders: vec![user("sam@example.com")],
    };
    let matching = in_channel(StackKind::Reaction, "General", ChannelType::Team);
    assert!(rule.matches(&matching));

    let other_kind = Conversation {
        kind: StackKind::NewMessage,
        ..matching.clone()
    };
    assert!(!rule.matches(&other_kind));

    let other_type = in_channel(StackKind::Reaction, "General", ChannelType::Public);
    assert!(!rule.matches(&other_type));

    let other_sender = Conversation {
        sender: Some(user("noor@example.com")),
        ..matching.clone()
    };
    assert!(!rule.matches(&other_sender));

    // A bot or an agent has no sender, so a rule about senders never
    // matches what it posts.
    let from_a_bot = Conversation {
        sender: None,
        ..matching.clone()
    };
    assert!(!rule.matches(&from_a_bot));

    let other_channel = Conversation {
        place: Place::Channel {
            id: "channel-2".to_string(),
            name: "General".to_string(),
            channel_type: ChannelType::Team,
        },
        ..matching
    };
    assert!(!rule.matches(&other_channel));
}

#[test]
fn a_channel_type_rule_matches_nothing_outside_channels() {
    let rule = StackRule {
        channel_types: vec![ChannelType::Public],
        ..Default::default()
    };

    assert!(!rule.matches(&on_document(
        StackKind::Comment,
        DocumentPlacement::default()
    )));
}

#[test]
fn the_first_stack_in_order_takes_the_notification() {
    let everything = || vec![kinds(&[StackKind::NewMessage])];
    let stacks = [
        stack(1, vec![kinds(&[StackKind::Reaction])], vec![]),
        stack(2, everything(), vec![]),
        stack(3, everything(), vec![]),
    ];

    let routed = in_channel(StackKind::NewMessage, "General", ChannelType::Public)
        .route(&stacks)
        .unwrap();

    assert_eq!(routed.record.stack_id, Uuid::from_u128(2));
}

#[test]
fn a_released_notification_is_not_offered_to_a_later_stack() {
    let stacks = [
        stack(
            1,
            vec![kinds(&[StackKind::Mention])],
            vec![kinds(&[StackKind::Mention])],
        ),
        stack(2, vec![kinds(&[StackKind::Mention])], vec![]),
    ];

    let routed = in_channel(StackKind::Mention, "General", ChannelType::Public)
        .route(&stacks)
        .unwrap();

    assert_eq!(routed.record.stack_id, Uuid::from_u128(1));
    assert_eq!(routed.record.outcome, RoutingOutcome::Released);
}

#[test]
fn a_document_stack_takes_comments_on_that_document() {
    let stacks = [stack(
        1,
        vec![from(StackSource::Document {
            id: "document-1".to_string(),
        })],
        vec![],
    )];

    let comment = on_document(StackKind::Comment, DocumentPlacement::default());
    assert!(comment.route(&stacks).is_some());

    let other = Conversation {
        place: Place::Document {
            id: "document-2".to_string(),
            is_task: false,
            placement: DocumentPlacement::default(),
        },
        ..comment
    };
    assert_eq!(other.route(&stacks), None);
}

#[test]
fn a_folder_stack_takes_documents_filed_anywhere_below_it() {
    let stacks = [stack(
        1,
        vec![from(StackSource::Folder {
            id: "folder-top".to_string(),
        })],
        vec![],
    )];

    let filed_below = on_document(
        StackKind::Comment,
        DocumentPlacement {
            folders: vec!["folder-leaf".to_string(), "folder-top".to_string()],
            project: None,
        },
    );
    assert!(filed_below.route(&stacks).is_some());

    let filed_elsewhere = on_document(
        StackKind::Comment,
        DocumentPlacement {
            folders: vec!["folder-other".to_string()],
            project: None,
        },
    );
    assert_eq!(filed_elsewhere.route(&stacks), None);
}

#[test]
fn a_project_stack_takes_its_discussion_and_its_tasks() {
    let stacks = [stack(
        1,
        vec![from(StackSource::Project {
            id: "project-1".to_string(),
        })],
        vec![],
    )];

    let discussion = Conversation {
        kind: StackKind::Comment,
        place: Place::Project {
            id: "project-1".to_string(),
        },
        sender: None,
    };
    assert!(discussion.route(&stacks).is_some());

    let task_in_it = on_document(
        StackKind::Comment,
        DocumentPlacement {
            folders: vec![],
            project: Some("project-1".to_string()),
        },
    );
    assert!(task_in_it.route(&stacks).is_some());

    let task_elsewhere = on_document(
        StackKind::Comment,
        DocumentPlacement {
            folders: vec![],
            project: Some("project-2".to_string()),
        },
    );
    assert_eq!(task_elsewhere.route(&stacks), None);
}

fn event(tag: &str, content: serde_json::Value) -> NotifEvent {
    serde_json::from_value(json!({ "tag": tag, "content": content })).unwrap()
}

fn channel_content() -> serde_json::Value {
    json!({
        "messageId": "message-1",
        "messageContent": "hello",
        "threadId": "thread-1",
        "emoji": "+1",
        "documentName": "Plan",
        "owner": "macro|owner@example.com",
        "fileType": "md",
        "channelType": "private",
        "channelName": "Macro Support: Acme",
    })
}

fn comment_content(sub_type: Option<&str>) -> serde_json::Value {
    json!({
        "documentName": "Plan",
        "owner": "macro|owner@example.com",
        "fileType": "md",
        "subType": sub_type.map(|sub_type| json!({ "type": sub_type })),
        "mentionId": "mention-1",
        "commentId": 1,
        "threadId": 1,
        "text": "hello",
    })
}

#[test]
fn channel_notifications_read_as_a_kind_in_their_channel() {
    let channel = EntityType::Channel.with_entity_str("channel-1");
    let sender = user("sam@example.com");
    let cases = [
        ("channel_message_send", StackKind::NewMessage),
        ("channel_mention", StackKind::Mention),
        ("channel_message_reply", StackKind::Reply),
        ("channel_message_reaction", StackKind::Reaction),
        ("document_mention", StackKind::DocumentMention),
    ];

    for (tag, kind) in cases {
        let conversation =
            Conversation::of(&event(tag, channel_content()), &channel, Some(&sender)).unwrap();

        assert_eq!(
            conversation,
            Conversation {
                kind,
                place: Place::Channel {
                    id: "channel-1".to_string(),
                    name: "Macro Support: Acme".to_string(),
                    channel_type: ChannelType::Private,
                },
                sender: Some(sender.clone()),
            },
            "{tag}"
        );
    }
}

#[test]
fn comment_notifications_read_as_a_kind_on_their_document() {
    let document = EntityType::Document.with_entity_str("document-1");
    let cases = [
        ("mentioned_in_document_comment", StackKind::Mention),
        ("replied_to_document_comment_thread", StackKind::Reply),
        ("commented_on_document", StackKind::Comment),
    ];

    for (tag, kind) in cases {
        let conversation =
            Conversation::of(&event(tag, comment_content(Some("task"))), &document, None).unwrap();

        assert_eq!(
            conversation,
            Conversation {
                kind,
                place: Place::Document {
                    id: "document-1".to_string(),
                    is_task: true,
                    placement: DocumentPlacement::default(),
                },
                sender: None,
            },
            "{tag}"
        );
    }

    let on_a_note = Conversation::of(
        &event("commented_on_document", comment_content(None)),
        &document,
        None,
    )
    .unwrap();
    assert!(matches!(
        on_a_note.place,
        Place::Document { is_task: false, .. }
    ));
}

#[test]
fn project_discussion_reads_as_a_kind_on_its_project() {
    let project = EntityType::Initiative.with_entity_str("project-1");
    let cases = [
        ("mention", StackKind::Mention),
        ("reply", StackKind::Reply),
        ("assignee", StackKind::Comment),
        ("owner", StackKind::Comment),
    ];

    for (reason, kind) in cases {
        let discussion = event(
            "initiative_discussion",
            json!({
                "projectName": "Launch",
                "owner": "macro|owner@example.com",
                "reason": reason,
                "messageId": Uuid::nil(),
                "threadId": Uuid::nil(),
                "text": "hello",
                "senderDisplayName": null,
                "senderProfilePictureUrl": null,
            }),
        );

        let conversation = Conversation::of(&discussion, &project, None).unwrap();

        assert_eq!(conversation.kind, kind, "{reason}");
        assert_eq!(
            conversation.place,
            Place::Project {
                id: "project-1".to_string()
            }
        );
    }
}

#[test]
fn a_task_assignment_is_never_a_conversation() {
    let assigned = event(
        "task_assigned",
        json!({
            "taskId": "document-1",
            "taskName": "Ship it",
            "subType": { "type": "task" },
            "assignedBy": "macro|sam@example.com",
        }),
    );

    let conversation = Conversation::of(
        &assigned,
        &EntityType::Document.with_entity_str("document-1"),
        Some(&user("sam@example.com")),
    );

    assert_eq!(conversation, None);
}
