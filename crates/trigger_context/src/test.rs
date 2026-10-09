use chrono::{TimeZone, Utc};
use serde_json::json;

use super::*;

#[test]
fn a_channel_follow_up_has_a_stable_wire_shape() {
    let context = TriggerContext::FollowUp(FollowUpContext {
        addressed_by: AddressedBy::ExplicitReply,
        discussion: DiscussionContext {
            surface: DiscussionSurface::Channel {
                id: Uuid::parse_str("00000000-0000-0000-0000-0000000000c1").unwrap(),
                name: Some("eng".to_owned()),
                channel_type: ChannelType::Public,
            },
            prompt_message_id: Uuid::parse_str("00000000-0000-0000-0000-000000000003").unwrap(),
            sender: ContextPerson {
                id: "macro|julia@example.com".to_owned(),
                name: "Julia".to_owned(),
                email: Some("julia@example.com".to_owned()),
            },
            reply_target: ReplyTarget::Quote {
                message_id: Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap(),
                thread_id: Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
                preview: "The popover scrolls the page".to_owned(),
                message: None,
            },
            thread: Some(ContextThread {
                root_id: Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
                messages: vec![ContextMessage {
                    id: Uuid::parse_str("00000000-0000-0000-0000-000000000003").unwrap(),
                    author: ContextPerson {
                        id: "macro|julia@example.com".to_owned(),
                        name: "Julia".to_owned(),
                        email: Some("julia@example.com".to_owned()),
                    },
                    content: "please fix".to_owned(),
                    posted_at: Utc.with_ymd_and_hms(2026, 10, 8, 14, 2, 0).unwrap(),
                }],
                messages_omitted: false,
            }),
            channel: Vec::new(),
        },
    });

    let wire = json!({
        "kind": "follow_up",
        "addressed_by": "explicit_reply",
        "discussion": {
            "surface": {
                "type": "channel",
                "id": "00000000-0000-0000-0000-0000000000c1",
                "name": "eng",
                "channel_type": "public"
            },
            "prompt_message_id": "00000000-0000-0000-0000-000000000003",
            "sender": {
                "id": "macro|julia@example.com",
                "name": "Julia",
                "email": "julia@example.com"
            },
            "reply_target": {
                "kind": "quote",
                "message_id": "00000000-0000-0000-0000-000000000002",
                "thread_id": "00000000-0000-0000-0000-000000000001",
                "preview": "The popover scrolls the page"
            },
            "thread": {
                "root_id": "00000000-0000-0000-0000-000000000001",
                "messages": [{
                    "id": "00000000-0000-0000-0000-000000000003",
                    "author": {
                        "id": "macro|julia@example.com",
                        "name": "Julia",
                        "email": "julia@example.com"
                    },
                    "content": "please fix",
                    "posted_at": "2026-10-08T14:02:00Z"
                }],
                "messages_omitted": false
            }
        }
    });

    assert_eq!(serde_json::to_value(&context).unwrap(), wire);
    assert_eq!(
        serde_json::from_value::<TriggerContext>(wire).unwrap(),
        context
    );
}

#[test]
fn a_task_assignment_has_a_stable_wire_shape() {
    let context = TriggerContext::TaskAssigned(TaskAssignedContext {
        task: TaskSnapshot {
            id: "task-1".to_owned(),
            title: "Fix calendar popover scroll".to_owned(),
            markdown: "The popover scrolls the page behind it.".to_owned(),
            status: Some("Todo".to_owned()),
            priority: Some("High".to_owned()),
            due: Some(Utc.with_ymd_and_hms(2026, 10, 10, 0, 0, 0).unwrap()),
            assignees: vec![ContextPerson {
                id: "bot|00000000-0000-0000-0000-00000000c5c5".to_owned(),
                name: "Cursor".to_owned(),
                email: None,
            }],
            project: Some(ProjectRef {
                id: Uuid::parse_str("00000000-0000-0000-0000-0000000000a1").unwrap(),
                name: "Calendar polish".to_owned(),
            }),
        },
        assigned_by: ContextPerson {
            id: "macro|julia@example.com".to_owned(),
            name: "Julia".to_owned(),
            email: Some("julia@example.com".to_owned()),
        },
        assigned_at: Utc.with_ymd_and_hms(2026, 10, 8, 14, 2, 0).unwrap(),
        discussion_id: Uuid::parse_str("00000000-0000-0000-0000-0000000000d1").unwrap(),
    });

    let wire = json!({
        "kind": "task_assigned",
        "task": {
            "id": "task-1",
            "title": "Fix calendar popover scroll",
            "markdown": "The popover scrolls the page behind it.",
            "status": "Todo",
            "priority": "High",
            "due": "2026-10-10T00:00:00Z",
            "assignees": [{
                "id": "bot|00000000-0000-0000-0000-00000000c5c5",
                "name": "Cursor"
            }],
            "project": {
                "id": "00000000-0000-0000-0000-0000000000a1",
                "name": "Calendar polish"
            }
        },
        "assigned_by": {
            "id": "macro|julia@example.com",
            "name": "Julia",
            "email": "julia@example.com"
        },
        "assigned_at": "2026-10-08T14:02:00Z",
        "discussion_id": "00000000-0000-0000-0000-0000000000d1"
    });

    assert_eq!(serde_json::to_value(&context).unwrap(), wire);
    assert_eq!(
        serde_json::from_value::<TriggerContext>(wire).unwrap(),
        context
    );
}
