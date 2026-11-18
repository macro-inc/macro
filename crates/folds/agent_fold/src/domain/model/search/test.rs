use std::path::PathBuf;

use non_empty::NonEmpty;
use serde_json::json;

use super::*;
use crate::domain::model::{
    Author, FileDiff, PlanEntry, PlanEntryPriority, PlanEntryStatus, ToolName, ToolStatus,
    ToolUseId, TurnId,
};

fn message(parts: Vec<MessagePart>) -> FoldedMessage {
    FoldedMessage {
        id: TurnId(4),
        author: Author::Agent,
        request_id: None,
        parts: NonEmpty::new(parts).expect("test message has parts"),
        stop: None,
        pending: false,
        posted_at: None,
    }
}

#[test]
fn readable_text_follows_render_order_and_nested_parts() {
    let projected = message(vec![
        MessagePart::Text {
            text: "I found the issue.".to_owned(),
        },
        MessagePart::Plan {
            entries: vec![PlanEntry {
                content: "Repair the session index".to_owned(),
                priority: PlanEntryPriority::High,
                status: PlanEntryStatus::InProgress,
            }],
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-1".to_owned()),
            name: ToolName::native("Agent"),
            status: ToolStatus::Completed,
            detail: ToolDetail::Subagent {
                title: "Inspect indexing".to_owned(),
                agent_type: Some("explore".to_owned()),
                description: None,
                prompt: Some("Trace the authoritative data path".to_owned()),
                background: false,
                children: vec![MessagePart::ToolUse {
                    id: ToolUseId("tool-2".to_owned()),
                    name: ToolName::native("Edit"),
                    status: ToolStatus::Completed,
                    detail: ToolDetail::Edit {
                        diffs: vec![FileDiff {
                            path: PathBuf::from("src/search.rs"),
                            old_text: Some("raw ACP".to_owned()),
                            new_text: "folded message".to_owned(),
                        }],
                    },
                }],
                result: Some(Box::new(SubagentResult {
                    text: Some("The fold is canonical.".to_owned()),
                    model: Some("test-model".to_owned()),
                    ..SubagentResult::default()
                })),
            },
        },
    ])
    .readable_text();

    assert_eq!(
        projected,
        [
            "I found the issue.",
            "Repair the session index",
            "Agent",
            "Inspect indexing",
            "explore",
            "Trace the authoritative data path",
            "Edit",
            "src/search.rs",
            "raw ACP",
            "folded message",
            "The fold is canonical.",
            "test-model",
        ]
        .join("\n")
    );
}

#[test]
fn readable_text_includes_folded_json_and_visible_failure() {
    let mut message = message(vec![MessagePart::ToolUse {
        id: ToolUseId("tool-1".to_owned()),
        name: ToolName::native("CreateDocument"),
        status: ToolStatus::Failed,
        detail: ToolDetail::Macro {
            input: json!({ "name": "Search notes" }),
            output: None,
            error: Some("document creation failed".to_owned()),
        },
    }]);
    message.stop = Some(StopReason::Failed {
        message: "runtime disconnected".to_owned(),
        notice: None,
    });

    assert_eq!(
        message.readable_text(),
        [
            "CreateDocument",
            "{\n  \"name\": \"Search notes\"\n}",
            "document creation failed",
            "runtime disconnected",
        ]
        .join("\n")
    );
}

#[test]
fn readable_text_omits_non_semantic_permission_boilerplate() {
    let message = message(vec![MessagePart::Permission {
        request_id: crate::domain::model::AgentRequestId::Number(7),
        tool_call: ToolUseId("tool-1".to_owned()),
        options: Vec::new(),
        outcome: PermissionOutcome::Pending,
    }]);

    assert_eq!(message.readable_text(), "");
}

#[test]
fn searchable_text_keeps_only_what_the_collapsed_transcript_shows() {
    use crate::domain::model::{PermissionOption, PermissionOptionKind};
    use dynamic_ui::{View, Widget};

    let message = message(vec![
        MessagePart::Thought {
            text: "Maybe the refresh is the problem".to_owned(),
        },
        MessagePart::Text {
            text: "I found the issue.".to_owned(),
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-1".to_owned()),
            name: ToolName::native("Edit"),
            status: ToolStatus::Completed,
            detail: ToolDetail::Edit {
                diffs: vec![FileDiff {
                    path: PathBuf::from("src/search.rs"),
                    old_text: Some("raw ACP".to_owned()),
                    new_text: "folded message".to_owned(),
                }],
            },
        },
        MessagePart::Permission {
            request_id: crate::domain::model::AgentRequestId::Number(7),
            tool_call: ToolUseId("tool-1".to_owned()),
            options: vec![PermissionOption {
                id: "allow".to_owned(),
                name: "Allow edits this session".to_owned(),
                kind: PermissionOptionKind::AllowOnce,
            }],
            outcome: PermissionOutcome::Selected {
                option_id: "allow".to_owned(),
            },
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-2".to_owned()),
            name: ToolName::native("CreateDocument"),
            status: ToolStatus::Completed,
            detail: ToolDetail::Macro {
                input: json!({ "name": "Search notes" }),
                output: Some(json!({ "id": "document-1" })),
                error: None,
            },
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-3".to_owned()),
            name: ToolName::native("Agent"),
            status: ToolStatus::Completed,
            detail: ToolDetail::Subagent {
                title: "Inspect indexing".to_owned(),
                agent_type: Some("explore".to_owned()),
                description: None,
                prompt: Some("Trace the authoritative data path".to_owned()),
                background: false,
                children: vec![MessagePart::Text {
                    text: "nested finding".to_owned(),
                }],
                result: Some(Box::new(SubagentResult {
                    text: Some("The fold is canonical.".to_owned()),
                    ..SubagentResult::default()
                })),
            },
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-4".to_owned()),
            name: ToolName::native("SendEmail"),
            status: ToolStatus::Completed,
            detail: ToolDetail::UserTool {
                input: json!({ "subject": "Weekly update", "body": "Draft body" }),
                outcome: UserToolOutcome::Pending,
            },
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-5".to_owned()),
            name: ToolName::native("DisplayResults"),
            status: ToolStatus::Completed,
            detail: ToolDetail::View {
                view: Some(View {
                    title: Some("Search status".to_owned()),
                    widgets: vec![Widget::Md {
                        markdown: "All shards healthy".to_owned(),
                    }],
                }),
                error: None,
            },
        },
        MessagePart::Plan {
            entries: vec![PlanEntry {
                content: "Repair the session index".to_owned(),
                priority: PlanEntryPriority::High,
                status: PlanEntryStatus::InProgress,
            }],
        },
    ]);

    assert_eq!(
        message.searchable_text(),
        [
            "I found the issue.",
            "Inspect indexing",
            "explore",
            "Weekly update",
            "Search status",
            "All shards healthy",
            "Repair the session index",
        ]
        .join("\n")
    );
    let readable = message.readable_text();
    for hidden in [
        "Maybe the refresh is the problem",
        "src/search.rs",
        "Allow edits this session",
        "Search notes",
        "nested finding",
        "Draft body",
    ] {
        assert!(readable.contains(hidden), "{hidden} stays readable");
    }
}
