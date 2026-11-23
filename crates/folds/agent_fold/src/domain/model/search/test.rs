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

#[test]
fn searchable_text_leaves_out_what_cards_and_lines_keep_behind_a_disclosure() {
    use crate::domain::model::{
        Control, ControlOutcome, ElicitationOutcome, ElicitationRequest, ElicitationRequestId,
        ElicitationSchema,
    };
    use agent_runtime_protocol::domain::{
        tool_approval::ToolApprovalStatus,
        turn::{FailureNotice, FailureNoticeKind},
    };
    use dynamic_ui::{View, Widget};

    let schema = ElicitationSchema {
        title: Some("Deploy window".to_owned()),
        description: None,
        properties: Vec::new(),
        required: Vec::new(),
    };
    let mut message = message(vec![
        MessagePart::Elicitation {
            request_id: ElicitationRequestId::Number(1),
            tool_call: None,
            message: "Which window should I use?".to_owned(),
            request: ElicitationRequest::Form {
                schema: schema.clone(),
            },
            outcome: ElicitationOutcome::Accepted {
                answers: Vec::new(),
            },
            reported: None,
            tool_outcome: None,
        },
        MessagePart::Elicitation {
            request_id: ElicitationRequestId::Number(2),
            tool_call: None,
            message: "Review the email".to_owned(),
            request: ElicitationRequest::UserTool {
                tool: "SendEmail".to_owned(),
                draft: Box::new(json!({ "subject": "Launch notes", "body": "Private draft body" })),
                schema: Box::new(schema),
            },
            outcome: ElicitationOutcome::Completed,
            reported: None,
            tool_outcome: Some(UserToolOutcome::Sent {
                message_id: "message-1".to_owned(),
                thread_id: "thread-1".to_owned(),
            }),
        },
        MessagePart::ToolApproval {
            approval_id: "approval-1".to_owned(),
            server_slug: "github".to_owned(),
            server_name: "GitHub".to_owned(),
            tool_name: "create_issue".to_owned(),
            arguments: json!({ "title": "Hidden argument" }),
            requested_by: None,
            status: ToolApprovalStatus::Approved,
            resolved_by: None,
            remembered: false,
            approver: None,
        },
        MessagePart::Control {
            control: Control::SetModel {
                model: "test-model".to_owned(),
            },
            outcome: ControlOutcome::Rejected {
                message: "model unavailable".to_owned(),
            },
        },
        MessagePart::ToolUse {
            id: ToolUseId("tool-1".to_owned()),
            name: ToolName::native("DisplayResults"),
            status: ToolStatus::Completed,
            detail: ToolDetail::View {
                view: Some(View {
                    title: None,
                    widgets: vec![Widget::Container {
                        direction: None,
                        gap: None,
                        wrap: None,
                        align: None,
                        justify: None,
                        title: Some("Unrendered container title".to_owned()),
                        children: vec![Widget::Md {
                            markdown: "Rollout is on track".to_owned(),
                        }],
                    }],
                }),
                error: Some("view failed to decode".to_owned()),
            },
        },
    ]);
    message.stop = Some(StopReason::Failed {
        message: "upstream 529".to_owned(),
        notice: None,
    });

    // The view reported an error beside its decoded content, so the transcript
    // shows only a failed card.
    assert_eq!(
        message.searchable_text(),
        [
            "Which window should I use?",
            "Launch notes",
            "GitHub",
            "test-model",
        ]
        .join("\n")
    );

    message.stop = Some(StopReason::Failed {
        message: "upstream 529".to_owned(),
        notice: Some(FailureNotice {
            kind: FailureNoticeKind::ProviderUsageLimit,
            title: "Usage limit reached".to_owned(),
            body: "Add credits to keep going".to_owned(),
            link: None,
        }),
    });
    assert!(
        message
            .searchable_text()
            .ends_with("Usage limit reached\nAdd credits to keep going")
    );
    assert!(!message.searchable_text().contains("upstream 529"));
}

#[test]
fn searchable_text_leaves_out_the_agent_context_a_prompt_hides() {
    let prompt = |text: &str| {
        let mut prompt = message(vec![MessagePart::Text {
            text: text.to_owned(),
        }]);
        prompt.author = Author::User { user_id: None };
        prompt
    };

    let hidden = prompt(
        "<m-agent-context>{\"version\":1,\"text\":\"Private instructions\"}</m-agent-context>\n\nSummarize the queue design",
    );
    assert_eq!(hidden.searchable_text(), "Summarize the queue design");
    assert!(hidden.readable_text().contains("Private instructions"));
    let windows = prompt(
        "<m-agent-context>{\"version\":1,\"text\":\"Private\"}</m-agent-context>\r\n\nSummarize",
    );
    assert_eq!(windows.searchable_text(), "Summarize");

    // The transcript does not hide any other block, so search keeps it.
    let shown = prompt(
        "<m-agent-context>{\"version\":1,\"text\":\"Private\",\"extra\":true}</m-agent-context>\n\nSummarize",
    );
    assert!(shown.searchable_text().contains("Private"));
    let mut reply = hidden.clone();
    reply.author = Author::Agent;
    assert!(reply.searchable_text().contains("Private instructions"));
}
