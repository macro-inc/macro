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
    }
}

#[test]
fn searchable_text_follows_render_order_and_nested_parts() {
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
    .searchable_text();

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
fn searchable_text_includes_folded_json_and_visible_failure() {
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
    });

    assert_eq!(
        message.searchable_text(),
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
fn searchable_text_omits_non_semantic_permission_boilerplate() {
    let message = message(vec![MessagePart::Permission {
        tool_call: ToolUseId("tool-1".to_owned()),
        options: Vec::new(),
        outcome: PermissionOutcome::Pending,
    }]);

    assert_eq!(message.searchable_text(), "");
}
