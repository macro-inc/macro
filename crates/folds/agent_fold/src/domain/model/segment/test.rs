use std::path::PathBuf;

use super::*;
use crate::domain::model::{
    AgentRequestId, AnsiText, AnsweredField, AnsweredValue, ElicitationRequestId,
    ElicitationSchema, ToolUseId,
};

fn text(text: &str) -> MessagePart {
    MessagePart::Text {
        text: text.to_owned(),
    }
}

fn thought(text: &str) -> MessagePart {
    MessagePart::Thought {
        text: text.to_owned(),
    }
}

fn run(id: &str, command: &str, status: ToolStatus) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId(id.to_owned()),
        name: ToolName::native("Bash"),
        status,
        detail: ToolDetail::Terminal {
            command: Some(command.to_owned()),
            output: Some(AnsiText(String::new())),
            exit_code: None,
        },
    }
}

fn read(id: &str, paths: &[&str], status: ToolStatus) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId(id.to_owned()),
        name: ToolName::native("Read"),
        status,
        detail: ToolDetail::Read {
            paths: paths.iter().map(PathBuf::from).collect(),
        },
    }
}

fn macro_tool(id: &str, name: &str, input: serde_json::Value, status: ToolStatus) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId(id.to_owned()),
        name: ToolName::native(name),
        status,
        detail: ToolDetail::Macro {
            input,
            output: None,
            error: None,
        },
    }
}

fn macro_result(
    id: &str,
    name: &str,
    input: serde_json::Value,
    output: serde_json::Value,
) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId(id.to_owned()),
        name: ToolName::native(name),
        status: ToolStatus::Completed,
        detail: ToolDetail::Macro {
            input,
            output: Some(output),
            error: None,
        },
    }
}

fn user_tool(
    id: &str,
    name: &str,
    input: serde_json::Value,
    outcome: UserToolOutcome,
) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId(id.to_owned()),
        name: ToolName::native(name),
        status: ToolStatus::Completed,
        detail: ToolDetail::UserTool { input, outcome },
    }
}

fn permission(id: i64, outcome: PermissionOutcome) -> MessagePart {
    MessagePart::Permission {
        request_id: AgentRequestId::Number(id),
        tool_call: ToolUseId(format!("call-{id}")),
        options: Vec::new(),
        outcome,
    }
}

fn kinds(segments: &[Segment]) -> Vec<(SegmentKind, bool)> {
    segments
        .iter()
        .map(|segment| (segment.kind, segment.sealed))
        .collect()
}

#[test]
fn code_execution_steps_show_observed_sdk_operations_without_source_or_results() {
    let part = MessagePart::ToolUse {
        id: ToolUseId("code-1".into()),
        name: ToolName::Mcp {
            server: "macro_internal".into(),
            tool: "ExecuteCode".into(),
        },
        status: ToolStatus::Completed,
        detail: ToolDetail::Other {
            kind: "other".into(),
            input: Some(serde_json::json!({"source": "secret program"})),
            result: Some(serde_json::json!({
                "result": {"data": "private result"},
                "activity": [
                    {"id": 1, "label": "Search documents", "status": "completed"},
                    {"id": 2, "label": "Read email", "status": "failed"},
                    {"id": 3, "label": "Create document", "status": "unknown"},
                    {"id": 4, "label": "Read email", "status": "running"}
                ]
            })),
            output: None,
            error: None,
        },
    };
    let live = segments(std::slice::from_ref(&part), false);
    assert_eq!(
        live[0].rows,
        vec![
            ActivityRow {
                id: "code-1:1".into(),
                label: "Search documents".into(),
                detail: None,
                status: ActivityStatus::Completed,
                card: None,
            },
            ActivityRow {
                id: "code-1:2".into(),
                label: "Read email".into(),
                detail: None,
                status: ActivityStatus::Failed,
                card: None,
            },
            ActivityRow {
                id: "code-1:3".into(),
                label: "Create document".into(),
                detail: None,
                status: ActivityStatus::Interrupted,
                card: None,
            },
            ActivityRow {
                id: "code-1:4".into(),
                label: "Read email".into(),
                detail: None,
                status: ActivityStatus::Running,
                card: None,
            },
        ]
    );
    assert_eq!(
        segments(std::slice::from_ref(&part), true)[0].rows[3].status,
        ActivityStatus::Interrupted
    );

    let mut external = part;
    if let MessagePart::ToolUse { name, .. } = &mut external {
        *name = ToolName::Mcp {
            server: "external".into(),
            tool: "ExecuteCode".into(),
        };
    }
    assert_eq!(segments(&[external], true)[0].rows.len(), 1);
}

#[test]
fn code_without_observed_requests_keeps_its_tool_step() {
    let part = MessagePart::ToolUse {
        id: ToolUseId("code-2".into()),
        name: ToolName::Mcp {
            server: "macro_internal".into(),
            tool: "ExecuteCode".into(),
        },
        status: ToolStatus::Completed,
        detail: ToolDetail::Macro {
            input: serde_json::json!({}),
            output: Some(serde_json::json!({"activity": []})),
            error: None,
        },
    };
    assert_eq!(segments(&[part], true)[0].rows[0].label, "Execute code");
}

#[test]
fn an_unfinished_passage_is_the_one_open_segment() {
    let parts = [text("Looking into it")];
    assert_eq!(
        kinds(&segments(&parts, false)),
        [(SegmentKind::Prose, false)]
    );
    assert_eq!(kinds(&segments(&parts, true)), [(SegmentKind::Prose, true)]);
}

#[test]
fn narration_work_and_answer_are_three_segments_with_the_steps_grouped() {
    let parts = [
        text("Checking the tests first."),
        run("a", "cargo test", ToolStatus::Completed),
        read("b", &["/repo/src/lib.rs"], ToolStatus::Completed),
        text("All green."),
    ];
    let segments = segments(&parts, true);
    assert_eq!(
        kinds(&segments),
        [
            (SegmentKind::Prose, true),
            (SegmentKind::Activity, true),
            (SegmentKind::Prose, true),
        ]
    );
    assert_eq!((segments[1].start, segments[1].end), (1, 3));
    assert_eq!(
        segments[1].rows,
        [
            ActivityRow {
                id: "a".to_owned(),
                label: "Ran".to_owned(),
                detail: Some("cargo test".to_owned()),
                status: ActivityStatus::Completed,
                card: None,
            },
            ActivityRow {
                id: "b".to_owned(),
                label: "Read".to_owned(),
                detail: Some("lib.rs".to_owned()),
                status: ActivityStatus::Completed,
                card: None,
            },
        ]
    );
    assert_eq!(
        segments.iter().map(|s| s.index).collect::<Vec<_>>(),
        [0, 1, 2]
    );
}

#[test]
fn a_blank_line_between_tool_calls_does_not_split_their_activity() {
    let parts = [
        run("a", "ls", ToolStatus::Completed),
        text("\n\n"),
        run("b", "pwd", ToolStatus::Running),
    ];
    let segments = segments(&parts, false);
    assert_eq!(kinds(&segments), [(SegmentKind::Activity, false)]);
    assert_eq!(segments[0].rows.len(), 2);
    assert_eq!(segments[0].rows[1].label, "Running");
}

#[test]
fn a_thought_inside_a_passage_belongs_to_no_segment() {
    let parts = [text("First half."), thought("hmm"), text("Second half.")];
    let segments = segments(&parts, true);
    assert_eq!(kinds(&segments), [(SegmentKind::Prose, true)]);
    assert_eq!(
        prose_text(&parts, &segments[0]),
        "First half.\n\nSecond half."
    );
}

#[test]
fn each_request_for_the_user_is_its_own_segment() {
    let parts = [
        permission(1, PermissionOutcome::Pending),
        permission(2, PermissionOutcome::Pending),
    ];
    assert_eq!(
        kinds(&segments(&parts, false)),
        [
            (SegmentKind::Interaction, true),
            (SegmentKind::Interaction, false),
        ]
    );
}

#[test]
fn an_answered_request_is_history_and_splits_no_run() {
    let parts = [
        run("a", "ls", ToolStatus::Completed),
        permission(1, PermissionOutcome::Cancelled),
        run("b", "pwd", ToolStatus::Completed),
    ];
    let segments = segments(&parts, true);
    assert_eq!(kinds(&segments), [(SegmentKind::Activity, true)]);
    assert_eq!(segments[0].rows.len(), 2);
}

fn email_review(outcome: ElicitationOutcome, tool_outcome: Option<UserToolOutcome>) -> MessagePart {
    MessagePart::Elicitation {
        request_id: ElicitationRequestId::Number(7),
        tool_call: Some(ToolUseId("call-email".to_owned())),
        message: "Send email?".to_owned(),
        request: ElicitationRequest::UserTool {
            tool: "SendEmail".to_owned(),
            draft: Box::new(serde_json::json!({
                "subject": "Launch plan",
                "to": [{"email": "ana@example.com", "name": "Ana Ruiz"}],
                "body": "Hi Ana"
            })),
            schema: Box::new(ElicitationSchema {
                title: None,
                description: None,
                properties: Vec::new(),
                required: Vec::new(),
            }),
        },
        outcome,
        reported: None,
        tool_outcome,
    }
}

#[test]
fn a_reviewed_email_is_the_step_that_sent_it_with_its_receipt() {
    let accepted = || ElicitationOutcome::Accepted {
        answers: Vec::new(),
    };
    let sent = [
        run("a", "ls", ToolStatus::Completed),
        email_review(
            accepted(),
            Some(UserToolOutcome::Sent {
                message_id: "m-1".to_owned(),
                thread_id: "thread-1".to_owned(),
            }),
        ),
    ];
    let segments_sent = segments(&sent, true);
    assert_eq!(kinds(&segments_sent), [(SegmentKind::Activity, true)]);
    let row = &segments_sent[0].rows[1];
    assert_eq!(row.label, "Sent email");
    assert_eq!(row.detail.as_deref(), Some("Launch plan"));
    assert_eq!(row.status, ActivityStatus::Completed);
    assert_eq!(
        row.card,
        Some(ActivityCard::Item {
            item_type: CardItemType::EmailThread,
            item_id: "thread-1".to_owned(),
            file_type: None,
            action: CardAction::Sent,
            title: Some("Launch plan".to_owned()),
            summary: Some("to Ana Ruiz".to_owned()),
        })
    );

    let sending = [email_review(accepted(), None)];
    let row = &segments(&sending, false)[0].rows[0];
    assert_eq!(
        (row.label.as_str(), row.status),
        ("Sending email", ActivityStatus::Running)
    );

    let discarded = [email_review(ElicitationOutcome::Declined, None)];
    let row = &segments(&discarded, true)[0].rows[0];
    assert_eq!(row.label, "Discarded email draft");
    assert_eq!(row.card, None);

    let waiting = [email_review(ElicitationOutcome::Pending, None)];
    assert_eq!(
        kinds(&segments(&waiting, false)),
        [(SegmentKind::Interaction, false)]
    );
}

#[test]
fn a_sent_emails_receipt_is_the_email_the_user_sent() {
    let answered = |draft: &str| ElicitationOutcome::Accepted {
        answers: vec![AnsweredField {
            name: "draft".to_owned(),
            label: "draft".to_owned(),
            value: AnsweredValue::Text {
                text: draft.to_owned(),
            },
        }],
    };
    let sent = || {
        Some(UserToolOutcome::Sent {
            message_id: "m-1".to_owned(),
            thread_id: "thread-1".to_owned(),
        })
    };
    // The user retitled the agent's draft and sent it to two others.
    let edited = serde_json::json!({
        "subject": "Launch plan (final)",
        "to": [{"email": "leo@example.com", "name": "Leo Park"}, {"email": "mia@example.com"}],
        "body": "Hi both"
    });
    let parts = [email_review(answered(&edited.to_string()), sent())];
    let row = &segments(&parts, true)[0].rows[0];
    assert_eq!(row.detail.as_deref(), Some("Launch plan (final)"));
    assert_eq!(
        row.card,
        Some(ActivityCard::Item {
            item_type: CardItemType::EmailThread,
            item_id: "thread-1".to_owned(),
            file_type: None,
            action: CardAction::Sent,
            title: Some("Launch plan (final)".to_owned()),
            summary: Some("to Leo Park and 1 other".to_owned()),
        })
    );

    // An answer with no whole draft in it sent the agent's draft.
    let unreadable = [email_review(answered("not a draft"), sent())];
    let row = &segments(&unreadable, true)[0].rows[0];
    assert_eq!(row.detail.as_deref(), Some("Launch plan"));
    assert!(matches!(
        &row.card,
        Some(ActivityCard::Item { title, summary, .. })
            if title.as_deref() == Some("Launch plan")
                && summary.as_deref() == Some("to Ana Ruiz")
    ));
}

#[test]
fn an_answered_question_says_it_was_answered_and_never_what() {
    let question = |tool_call: Option<&str>| MessagePart::Elicitation {
        request_id: ElicitationRequestId::Number(3),
        tool_call: tool_call.map(|id| ToolUseId(id.to_owned())),
        message: "Which deck should I start from?".to_owned(),
        request: ElicitationRequest::Form {
            schema: ElicitationSchema {
                title: None,
                description: None,
                properties: Vec::new(),
                required: Vec::new(),
            },
        },
        outcome: ElicitationOutcome::Accepted {
            answers: Vec::new(),
        },
        reported: None,
        tool_outcome: None,
    };
    let in_place = [question(Some("call-ask"))];
    let row = &segments(&in_place, true)[0].rows[0];
    assert_eq!(row.label, "Answered");
    assert_eq!(
        row.detail.as_deref(),
        Some("Which deck should I start from?")
    );
    // A question its own tool asked is told by that tool's row.
    let beside_its_tool = [
        macro_tool(
            "ask",
            "AskUser",
            serde_json::json!({"question": "Which deck should I start from?"}),
            ToolStatus::Completed,
        ),
        question(None),
    ];
    let segments = segments(&beside_its_tool, true);
    assert_eq!(kinds(&segments), [(SegmentKind::Activity, true)]);
    assert_eq!(segments[0].rows.len(), 1);
}

#[test]
fn a_step_still_running_when_the_turn_ended_is_interrupted() {
    let parts = [run("a", "sleep 100", ToolStatus::Running)];
    let row = &segments(&parts, true)[0].rows[0];
    assert_eq!(row.status, ActivityStatus::Interrupted);
    assert_eq!(row.label, "Ran");
}

#[test]
fn only_sealed_prose_carries_its_text_to_the_server() {
    let parts = [
        text("Narration."),
        run("a", "ls", ToolStatus::Running),
        text("Answer in progress"),
    ];
    let open = project(&parts, false);
    assert_eq!(open[0].text.as_deref(), Some("Narration."));
    assert_eq!(open[1].text, None);
    assert_eq!(open[2].text, None);
    let closed = project(&parts, true);
    assert_eq!(closed[2].text.as_deref(), Some("Answer in progress"));
}

#[test]
fn the_phase_follows_the_last_thing_the_agent_did() {
    assert_eq!(phase(&[], false), Some(TurnPhase::Thinking));
    assert_eq!(phase(&[text("Hi")], false), Some(TurnPhase::Writing));
    assert_eq!(
        phase(&[text("Hi"), thought("now what")], false),
        Some(TurnPhase::Thinking)
    );
    assert_eq!(
        phase(&[run("a", "ls", ToolStatus::Running)], false),
        Some(TurnPhase::Working)
    );
    assert_eq!(
        phase(&[run("a", "ls", ToolStatus::Completed)], false),
        Some(TurnPhase::Thinking)
    );
    assert_eq!(
        phase(&[permission(1, PermissionOutcome::Pending)], false),
        Some(TurnPhase::Waiting)
    );
    assert_eq!(phase(&[text("Done")], true), None);
}

#[test]
fn a_pending_request_waits_even_when_its_tool_reports_after_it() {
    // AskUser sends its question, then reports itself running.
    let parts = [
        permission(1, PermissionOutcome::Pending),
        run("a", "ask", ToolStatus::Running),
    ];
    assert_eq!(phase(&parts, false), Some(TurnPhase::Waiting));
    let answered = [
        permission(
            1,
            PermissionOutcome::Selected {
                option_id: "allow".to_owned(),
            },
        ),
        run("a", "ask", ToolStatus::Running),
    ];
    assert_eq!(phase(&answered, false), Some(TurnPhase::Working));
}

#[test]
fn long_commands_keep_their_first_line_cut_to_length() {
    let long = format!("echo {}\nsecond line", "x".repeat(200));
    let parts = [run("a", &long, ToolStatus::Completed)];
    let detail = segments(&parts, true)[0].rows[0].detail.clone().unwrap();
    assert!(detail.ends_with('…'));
    assert_eq!(detail.chars().count(), DETAIL_MAX_CHARS);
    assert!(!detail.contains("second"));
}

#[test]
fn several_files_are_counted_rather_than_listed() {
    let parts = [read(
        "a",
        &["/a.rs", "/b.rs", "/c.rs"],
        ToolStatus::Completed,
    )];
    assert_eq!(
        segments(&parts, true)[0].rows[0].detail.as_deref(),
        Some("3 files")
    );
}

#[test]
fn macro_tools_read_as_their_name_with_what_they_acted_on() {
    let parts = [
        macro_tool(
            "a",
            "SearchDocuments",
            serde_json::json!({"query": "quarterly report", "limit": 5}),
            ToolStatus::Completed,
        ),
        macro_tool(
            "b",
            "list_entities",
            serde_json::json!({"limit": 5}),
            ToolStatus::Failed,
        ),
        macro_tool(
            "c",
            "CreateDocument",
            serde_json::json!({"documentName": "Launch FAQ", "fileContent": "..."}),
            ToolStatus::Completed,
        ),
    ];
    let rows = &segments(&parts, true)[0].rows;
    assert_eq!(rows[0].label, "Search documents");
    assert_eq!(rows[0].detail.as_deref(), Some("quarterly report"));
    assert_eq!(rows[1].label, "List entities failed");
    assert_eq!(rows[1].detail, None);
    assert_eq!(rows[2].label, "Create document");
    assert_eq!(rows[2].detail.as_deref(), Some("Launch FAQ"));
}

#[test]
fn a_created_document_is_a_card_named_as_the_agent_named_it() {
    let parts = [macro_result(
        "a",
        "CreateDocument",
        serde_json::json!({"documentName": "Launch FAQ", "fileExtension": "md", "fileContent": "..."}),
        serde_json::json!({"documentId": "doc-1"}),
    )];
    let rows = &segments(&parts, true)[0].rows;
    assert_eq!(
        rows[0].card,
        Some(ActivityCard::Item {
            item_type: CardItemType::Document,
            item_id: "doc-1".to_owned(),
            file_type: Some("md".to_owned()),
            action: CardAction::Created,
            title: Some("Launch FAQ".to_owned()),
            summary: None,
        })
    );
}

#[test]
fn a_step_earns_its_card_only_once_it_has_finished() {
    let parts = [
        macro_tool(
            "a",
            "CreateDocument",
            serde_json::json!({"documentName": "Launch FAQ"}),
            ToolStatus::Running,
        ),
        macro_tool(
            "b",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-1"}),
            ToolStatus::Failed,
        ),
    ];
    let rows = &segments(&parts, false)[0].rows;
    assert!(rows.iter().all(|row| row.card.is_none()));
}

#[test]
fn edits_name_the_document_they_changed() {
    let parts = [
        macro_tool(
            "a",
            "EditDocument",
            serde_json::json!({"document_id": "doc-1", "instructions": "tighten it"}),
            ToolStatus::Completed,
        ),
        macro_tool(
            "b",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-1", "operations": []}),
            ToolStatus::Completed,
        ),
    ];
    let cards: Vec<_> = segments(&parts, true)[0]
        .rows
        .iter()
        .map(|row| row.card.clone())
        .collect();
    assert_eq!(
        cards,
        [
            Some(ActivityCard::Item {
                item_type: CardItemType::Document,
                item_id: "doc-1".to_owned(),
                file_type: Some("md".to_owned()),
                action: CardAction::Edited,
                title: None,
                summary: None,
            }),
            Some(ActivityCard::Item {
                item_type: CardItemType::Document,
                item_id: "sheet-1".to_owned(),
                file_type: Some("spreadsheet".to_owned()),
                action: CardAction::Edited,
                title: None,
                summary: None,
            }),
        ]
    );
}

#[test]
fn an_edit_that_asked_for_clarification_changed_nothing() {
    let parts = [macro_result(
        "a",
        "EditDocument",
        serde_json::json!({"document_id": "doc-1", "instructions": "tighten it"}),
        serde_json::json!({
            "summary": "Paused for clarification; no edits applied.",
            "clarification": "Which section?"
        }),
    )];
    assert_eq!(segments(&parts, true)[0].rows[0].card, None);
}

#[test]
fn a_shown_view_is_its_card() {
    let view =
        serde_json::json!({"title": "Your week", "widgets": [{"type": "md", "markdown": "Hi"}]});
    // Replies saved before the tool's rename call it `DisplayResults`.
    for tool in ["Show", "DisplayResults"] {
        let parts = [macro_tool(
            "a",
            tool,
            serde_json::json!({"view": view.clone()}),
            ToolStatus::Completed,
        )];
        assert_eq!(
            segments(&parts, true)[0].rows[0].card,
            Some(ActivityCard::View { view: view.clone() }),
            "{tool}"
        );
    }
}

#[test]
fn a_view_being_shown_reads_as_its_title() {
    let parts = [macro_tool(
        "a",
        "Show",
        serde_json::json!({"view": {"title": "Your week", "widgets": []}}),
        ToolStatus::Running,
    )];
    let row = &segments(&parts, false)[0].rows[0];
    assert_eq!(row.label, "Showing");
    assert_eq!(row.detail.as_deref(), Some("Your week"));
}

#[test]
fn a_view_turned_back_is_no_step_and_splits_nothing() {
    let view = serde_json::json!({"widgets": [{"type": "pipeline"}]});
    let parts = [
        macro_tool(
            "a",
            "ListEntities",
            serde_json::json!({}),
            ToolStatus::Completed,
        ),
        macro_tool(
            "b",
            "Show",
            serde_json::json!({"view": view}),
            ToolStatus::Failed,
        ),
        macro_tool(
            "c",
            "ReadContent",
            serde_json::json!({}),
            ToolStatus::Completed,
        ),
    ];
    let run = segments(&parts, true);
    assert_eq!(run.len(), 1);
    let ids: Vec<_> = run[0].rows.iter().map(|row| row.id.as_str()).collect();
    assert_eq!(ids, ["a", "c"]);

    // Alone, it leaves no run at all.
    assert!(segments(&parts[1..2], true).is_empty());
}

#[test]
fn calendar_tools_card_the_event_they_returned() {
    let event = serde_json::json!({"eventId": "event-1", "title": "Design review", "start": "2026-10-09T15:00:00Z"});
    let parts = [
        macro_result(
            "a",
            "CreateConfirmedCalendarEvent",
            serde_json::json!({}),
            event.clone(),
        ),
        macro_result(
            "b",
            "UpdateCalendarEvent",
            serde_json::json!({}),
            event.clone(),
        ),
        user_tool(
            "c",
            "CreateCalendarEvent",
            serde_json::json!({"title": "Design review"}),
            UserToolOutcome::Completed { result: event },
        ),
    ];
    let actions: Vec<_> = segments(&parts, true)[0]
        .rows
        .iter()
        .map(|row| match &row.card {
            Some(ActivityCard::Item {
                item_type: CardItemType::CalendarEvent,
                item_id,
                title,
                action,
                ..
            }) => {
                assert_eq!(item_id, "event-1");
                assert_eq!(title.as_deref(), Some("Design review"));
                *action
            }
            other => panic!("expected an event card, got {other:?}"),
        })
        .collect();
    assert_eq!(
        actions,
        [CardAction::Created, CardAction::Edited, CardAction::Created]
    );
}

#[test]
fn a_sent_email_is_a_card_and_an_unsent_draft_is_not() {
    let draft = serde_json::json!({"subject": "Launch plan", "to": ["ada@example.com"]});
    let parts = [
        user_tool(
            "a",
            "SendEmail",
            draft.clone(),
            UserToolOutcome::Sent {
                message_id: "message-1".to_owned(),
                thread_id: "thread-1".to_owned(),
            },
        ),
        user_tool("b", "SendEmail", draft, UserToolOutcome::Pending),
    ];
    let rows = &segments(&parts, true)[0].rows;
    assert_eq!(
        rows[0].card,
        Some(ActivityCard::Item {
            item_type: CardItemType::EmailThread,
            item_id: "thread-1".to_owned(),
            file_type: None,
            action: CardAction::Sent,
            title: Some("Launch plan".to_owned()),
            summary: Some("to ada@example.com".to_owned()),
        })
    );
    assert_eq!(rows[1].card, None);
}

#[test]
fn a_card_travels_in_the_row_it_belongs_to() {
    let plain = ActivityRow {
        id: "a".to_owned(),
        label: "Ran".to_owned(),
        detail: None,
        status: ActivityStatus::Completed,
        card: None,
    };
    assert_eq!(
        serde_json::to_value(&plain).unwrap(),
        serde_json::json!({"id": "a", "label": "Ran", "detail": null, "status": "completed", "card": null})
    );
    let carded = ActivityRow {
        card: Some(ActivityCard::Item {
            item_type: CardItemType::EmailThread,
            item_id: "thread-1".to_owned(),
            file_type: None,
            action: CardAction::Sent,
            title: None,
            summary: None,
        }),
        ..plain
    };
    assert_eq!(
        serde_json::to_value(&carded).unwrap()["card"],
        serde_json::json!({
            "kind": "item",
            "itemType": "email_thread",
            "itemId": "thread-1",
            "fileType": null,
            "action": "sent",
            "title": null,
            "summary": null,
        })
    );
}

/// A receipt as a test reads it: the item's kind and id, what was done, and
/// the summary.
type Receipt = (CardItemType, String, CardAction, Option<String>);

/// The kind, id, action and summary of each card the rows earned.
fn receipts(parts: &[MessagePart]) -> Vec<Option<Receipt>> {
    segments(parts, true)[0]
        .rows
        .iter()
        .map(|row| match &row.card {
            Some(ActivityCard::Item {
                item_type,
                item_id,
                action,
                summary,
                ..
            }) => Some((*item_type, item_id.clone(), *action, summary.clone())),
            _ => None,
        })
        .collect()
}

fn receipt(
    item_type: CardItemType,
    id: &str,
    action: CardAction,
    summary: Option<&str>,
) -> Option<Receipt> {
    Some((item_type, id.to_owned(), action, summary.map(str::to_owned)))
}

#[test]
fn a_spreadsheet_edit_counts_its_changes() {
    let parts = [
        macro_result(
            "a",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-1"}),
            serde_json::json!({"applied": true, "changes": [
                {"type": "cells", "sheetId": "s1", "summary": "12 cells in EMEA"}
            ]}),
        ),
        macro_result(
            "b",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-2"}),
            serde_json::json!({"applied": true, "changes": [
                {"type": "cells", "sheetId": "s1", "summary": "A"},
                {"type": "format", "sheetId": "s1", "summary": "B"},
                {"type": "sheet", "sheetId": "s2", "summary": "C"}
            ]}),
        ),
        macro_result(
            "c",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-3"}),
            serde_json::json!({"applied": false, "changes": []}),
        ),
    ];
    assert_eq!(
        receipts(&parts),
        [
            receipt(CardItemType::Document, "sheet-1", CardAction::Edited, None),
            receipt(
                CardItemType::Document,
                "sheet-2",
                CardAction::Edited,
                Some("3 changes")
            ),
            None,
        ]
    );
}

#[test]
fn a_sent_email_says_who_it_went_to() {
    let parts = [
        macro_result(
            "a",
            "SendConfirmedEmail",
            serde_json::json!({
                "subject": "Q4 pricing",
                "to": [{"email": "ana@example.com", "name": "Ana Ruiz"}, {"email": "leo@example.com"}]
            }),
            serde_json::json!({"sent": {"message_id": "m-1", "thread_id": "thread-1"}}),
        ),
        user_tool(
            "b",
            "SendEmail",
            serde_json::json!({"subject": "Launch plan", "to": ["ada@example.com"]}),
            UserToolOutcome::Sent {
                message_id: "m-2".to_owned(),
                thread_id: "thread-2".to_owned(),
            },
        ),
    ];
    assert_eq!(
        receipts(&parts),
        [
            receipt(
                CardItemType::EmailThread,
                "thread-1",
                CardAction::Sent,
                Some("to Ana Ruiz and 1 other")
            ),
            receipt(
                CardItemType::EmailThread,
                "thread-2",
                CardAction::Sent,
                Some("to ada@example.com")
            ),
        ]
    );
}

#[test]
fn every_kind_of_item_a_step_changes_is_a_receipt() {
    let parts = [
        macro_result(
            "a",
            "CreateProject",
            serde_json::json!({"name": "Q4 launch"}),
            serde_json::json!({"projectId": "project-1", "projectName": "Q4 launch"}),
        ),
        macro_result(
            "b",
            "MoveToProject",
            serde_json::json!({"entityType": "document", "entityId": "doc-1", "projectId": "project-1"}),
            serde_json::json!({"success": true, "message": "Moved"}),
        ),
        macro_result(
            "c",
            "MoveToProject",
            serde_json::json!({"entityType": "email", "entityId": "thread-1"}),
            serde_json::json!({"success": true, "message": "Moved"}),
        ),
        macro_result(
            "d",
            "CreateChannel",
            serde_json::json!({"name": "pricing"}),
            serde_json::json!({"channelId": "channel-1", "name": "pricing"}),
        ),
        macro_result(
            "e",
            "RenameChannel",
            serde_json::json!({"channelId": "channel-1", "name": "pricing-q4"}),
            serde_json::json!({"channelId": "channel-1", "name": "pricing-q4", "previousName": "pricing"}),
        ),
        macro_result(
            "f",
            "CreateRoutine",
            serde_json::json!({"configuration": {"name": "Weekly digest"}}),
            serde_json::json!({"id": "routine-1", "name": "Weekly digest", "enabled": true}),
        ),
        macro_result(
            "g",
            "UpdateRoutine",
            serde_json::json!({"routineId": "routine-1", "change": {"type": "enabled", "enabled": false}}),
            serde_json::json!({"id": "routine-1", "name": "Weekly digest", "enabled": false}),
        ),
        macro_result(
            "h",
            "CreateForm",
            serde_json::json!({"name": "Intake"}),
            serde_json::json!({"state": "partiallyApplied", "formId": "form-1"}),
        ),
        macro_result(
            "i",
            "CreateInitiative",
            serde_json::json!({"name": "Renewals"}),
            serde_json::json!({"initiativeId": "initiative-1", "name": "Renewals"}),
        ),
        macro_result(
            "j",
            "RenameDocument",
            serde_json::json!({"documentId": "doc-2", "documentName": "Plan v2"}),
            serde_json::json!({"success": true, "documentId": "doc-2", "message": "Renamed"}),
        ),
        macro_result(
            "k",
            "CommentOnDocument",
            serde_json::json!({"documentId": "doc-3"}),
            serde_json::json!({"documentId": "doc-3", "threadId": "t", "commentId": "c", "markedText": "Q4 targets"}),
        ),
        macro_result(
            "l",
            "DeleteCalendarEvent",
            serde_json::json!({"eventId": "event-1", "scope": "this_event"}),
            serde_json::json!({"eventId": "event-1", "summary": "Deleted one occurrence of the event."}),
        ),
        macro_result(
            "m",
            "SetEntityProperty",
            serde_json::json!({"entity_id": "doc-4", "entity_type": "document"}),
            serde_json::json!({"success": true, "message": "Property updated successfully."}),
        ),
    ];
    assert_eq!(
        receipts(&parts),
        [
            receipt(
                CardItemType::Project,
                "project-1",
                CardAction::Created,
                None
            ),
            receipt(CardItemType::Document, "doc-1", CardAction::Moved, None),
            receipt(
                CardItemType::EmailThread,
                "thread-1",
                CardAction::Moved,
                Some("to the top level")
            ),
            receipt(
                CardItemType::Channel,
                "channel-1",
                CardAction::Created,
                None
            ),
            receipt(
                CardItemType::Channel,
                "channel-1",
                CardAction::Renamed,
                Some("was pricing")
            ),
            receipt(
                CardItemType::Routine,
                "routine-1",
                CardAction::Created,
                None
            ),
            receipt(
                CardItemType::Routine,
                "routine-1",
                CardAction::Updated,
                Some("Paused")
            ),
            receipt(
                CardItemType::Form,
                "form-1",
                CardAction::Created,
                Some("Partly saved")
            ),
            receipt(
                CardItemType::Initiative,
                "initiative-1",
                CardAction::Created,
                None
            ),
            receipt(CardItemType::Document, "doc-2", CardAction::Renamed, None),
            receipt(CardItemType::Document, "doc-3", CardAction::Commented, None),
            receipt(
                CardItemType::CalendarEvent,
                "event-1",
                CardAction::Deleted,
                Some("One occurrence")
            ),
            receipt(CardItemType::Document, "doc-4", CardAction::Updated, None),
        ]
    );
}

#[test]
fn a_change_that_did_not_happen_is_no_receipt() {
    let parts = [
        macro_result(
            "a",
            "MoveToProject",
            serde_json::json!({"entityType": "document", "entityId": "doc-1", "projectId": "p"}),
            serde_json::json!({"success": false, "message": "No access"}),
        ),
        macro_result(
            "b",
            "SetEntityProperty",
            serde_json::json!({"entity_id": "macro|ana@example.com", "entity_type": "user"}),
            serde_json::json!({"success": true, "message": "Property updated successfully."}),
        ),
        macro_result(
            "c",
            "MoveToProject",
            serde_json::json!({"entityType": "chat", "entityId": "chat-1", "projectId": "p"}),
            serde_json::json!({"success": true, "message": "Moved"}),
        ),
    ];
    assert_eq!(receipts(&parts), [None, None, None]);
}

#[test]
fn an_upload_and_a_saved_copy_are_new_files() {
    let parts = [
        macro_result(
            "a",
            "UploadFile",
            serde_json::json!({"fileName": "Vendor MSA.PDF"}),
            serde_json::json!({"documentId": "doc-1", "fileName": "Vendor MSA.PDF", "sizeBytes": 10}),
        ),
        macro_result(
            "b",
            "EditPresentation",
            serde_json::json!({"documentId": "deck-1", "saveAs": {"name": "Board deck v2"}}),
            serde_json::json!({"documentId": "deck-2"}),
        ),
        macro_result(
            "c",
            "EditPresentation",
            serde_json::json!({"documentId": "deck-1"}),
            serde_json::json!({"documentId": "deck-1"}),
        ),
    ];
    let cards: Vec<_> = segments(&parts, true)[0]
        .rows
        .iter()
        .map(|row| row.card.clone())
        .collect();
    assert_eq!(
        cards,
        [
            Some(ActivityCard::Item {
                item_type: CardItemType::Document,
                item_id: "doc-1".to_owned(),
                file_type: Some("pdf".to_owned()),
                action: CardAction::Created,
                title: Some("Vendor MSA.PDF".to_owned()),
                summary: None,
            }),
            Some(ActivityCard::Item {
                item_type: CardItemType::Document,
                item_id: "deck-2".to_owned(),
                file_type: Some("pptx".to_owned()),
                action: CardAction::Created,
                title: Some("Board deck v2".to_owned()),
                summary: None,
            }),
            Some(ActivityCard::Item {
                item_type: CardItemType::Document,
                item_id: "deck-1".to_owned(),
                file_type: Some("pptx".to_owned()),
                action: CardAction::Edited,
                title: None,
                summary: None,
            }),
        ]
    );
}

#[test]
fn a_database_answer_is_a_card_only_when_the_agent_asked_to_show_it() {
    let select = serde_json::json!({"results": [], "statement": {"kind": "select"}});
    let parts = [
        macro_result(
            "a",
            "QueryDatabase",
            serde_json::json!({"sql": "SELECT plan, arr FROM deals", "databaseId": "db-1", "display": "bar"}),
            select.clone(),
        ),
        macro_result(
            "b",
            "QueryDatabase",
            serde_json::json!({"sql": "SELECT count(*) FROM deals"}),
            select,
        ),
        macro_result(
            "c",
            "QueryDatabase",
            serde_json::json!({"sql": "UPDATE deals SET arr = 0", "display": "table"}),
            serde_json::json!({"results": [], "statement": {"kind": "write"}}),
        ),
    ];
    let cards: Vec<_> = segments(&parts, true)[0]
        .rows
        .iter()
        .map(|row| row.card.clone())
        .collect();
    assert_eq!(
        cards,
        [
            Some(ActivityCard::Data {
                sql: "SELECT plan, arr FROM deals".to_owned(),
                database_id: Some("db-1".to_owned()),
                display: Some("bar".to_owned()),
            }),
            None,
            None,
        ]
    );
}

#[test]
fn an_edit_counts_its_changes_when_it_made_several() {
    let parts = [
        macro_result(
            "a",
            "EditDocument",
            serde_json::json!({"document_id": "doc-1", "instructions": "Add a **pricing** section after the intro.\nKeep the rest."}),
            serde_json::json!({"summary": "Applied.", "clarification": null}),
        ),
        macro_result(
            "b",
            "EditWordDocument",
            serde_json::json!({"documentId": "doc-2", "operations": [{}, {}, {}]}),
            serde_json::json!({}),
        ),
        macro_result(
            "c",
            "EditWordDocument",
            serde_json::json!({"documentId": "doc-3", "operations": [{}]}),
            serde_json::json!({}),
        ),
    ];
    let summaries: Vec<_> = receipts(&parts)
        .into_iter()
        .map(|card| card.and_then(|(_, _, _, summary)| summary))
        .collect();
    assert_eq!(summaries, [None, Some("3 changes".to_owned()), None]);
}

/// Everyone who reads the conversation reads a stored receipt, including
/// readers who cannot open its item: a receipt may count, name and address,
/// but never quote what the item says.
#[test]
fn a_receipt_never_quotes_the_item() {
    let parts = [
        macro_result(
            "a",
            "EditDocument",
            serde_json::json!({"document_id": "doc-1", "instructions": "Add the layoff list to section 2"}),
            serde_json::json!({"summary": "Applied.", "clarification": null}),
        ),
        macro_result(
            "b",
            "CommentOnDocument",
            serde_json::json!({"documentId": "doc-2", "comment": "Is this right?"}),
            serde_json::json!({"documentId": "doc-2", "threadId": "t", "commentId": "c", "markedText": "Severance: 3 months"}),
        ),
        macro_result(
            "c",
            "SendChannelMessage",
            serde_json::json!({"channel_id": "channel-1", "content": "Offer to Ana: 180k base"}),
            serde_json::json!({"channel_id": "channel-1", "message_id": "m-1"}),
        ),
        macro_result(
            "d",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-1"}),
            serde_json::json!({"applied": true, "changes": [
                {"type": "cells", "sheetId": "s1", "summary": "Salary set to 180000 for Ana"}
            ]}),
        ),
        macro_result(
            "e",
            "EditSpreadsheet",
            serde_json::json!({"documentId": "sheet-2"}),
            serde_json::json!({"applied": true, "changes": [
                {"type": "cells", "sheetId": "s1", "summary": "Bonus pool cut to 2%"},
                {"type": "format", "sheetId": "s1", "summary": "Bolded the totals"}
            ]}),
        ),
    ];
    let rows = &segments(&parts, true)[0].rows;
    assert!(
        rows.iter().all(|row| row.card.is_some()),
        "every step still earns its receipt: {rows:#?}"
    );
    let cards: Vec<_> = rows.iter().map(|row| &row.card).collect();
    let stored = serde_json::to_string(&cards).unwrap();
    for quoted in [
        "layoff",
        "Severance",
        "180k",
        "180000",
        "Bonus pool",
        "totals",
    ] {
        assert!(!stored.contains(quoted), "{quoted:?} is stored: {stored}");
    }
}

#[test]
fn humanize_keeps_acronyms_and_splits_every_convention() {
    assert_eq!(humanize("ListEntities"), "List entities");
    assert_eq!(humanize("read_document"), "Read document");
    assert_eq!(humanize("web-search"), "Web search");
    assert_eq!(humanize("FetchURL"), "Fetch URL");
    assert_eq!(humanize(""), "Tool");
}

#[test]
fn session_activity_retains_command_and_tool_input_details_for_authorized_live_views() {
    let command = "TOKEN=private-value run-report";
    let query = "confidential acquisition";
    let parts = [
        run("terminal", command, ToolStatus::Completed),
        macro_tool(
            "search",
            "search",
            serde_json::json!({"query": query}),
            ToolStatus::Completed,
        ),
    ];
    let live = segments(&parts, true);
    assert_eq!(live[0].rows[0].detail.as_deref(), Some(command));
    assert_eq!(live[0].rows[1].detail.as_deref(), Some(query));
}

const REVIEW: &str = "0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6";

fn presentation(
    id: &str,
    server: &str,
    input: serde_json::Value,
    status: ToolStatus,
) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId(id.to_owned()),
        name: ToolName::Mcp {
            server: server.to_owned(),
            tool: "PresentReview".to_owned(),
        },
        status,
        detail: ToolDetail::Other {
            kind: "other".to_owned(),
            output: None,
            input: Some(input),
            result: None,
            error: None,
        },
    }
}

fn review_input(review: &str, kind: &str) -> serde_json::Value {
    serde_json::json!({"reviewId": review, "kind": kind, "title": "Follow-ups"})
}

#[test]
fn a_presented_review_is_its_card_and_the_agents_call_for_it_is_a_step() {
    // The agent asks for the review, and Macro presents it under the
    // review's own id: one card, under the presentation.
    let parts = [
        presentation(
            "call_1",
            "macro_internal",
            review_input(REVIEW, "email"),
            ToolStatus::Completed,
        ),
        presentation(
            &format!("review_{REVIEW}"),
            "macro_internal",
            review_input(REVIEW, "email"),
            ToolStatus::Completed,
        ),
    ];
    let rows = &segments(&parts, true)[0].rows;
    assert_eq!(rows[0].card, None);
    assert_eq!(rows[0].label, "Prepared drafts to review");
    assert_eq!(rows[0].detail.as_deref(), Some("Follow-ups"));
    assert_eq!(
        rows[1].card,
        Some(ActivityCard::Review {
            review_id: REVIEW.to_owned(),
            drafts: ReviewDrafts::Email,
        })
    );
    assert_eq!(
        serde_json::to_value(rows[1].card.as_ref().unwrap()).unwrap(),
        serde_json::json!({"kind": "review", "reviewId": REVIEW, "drafts": "email"})
    );
}

#[test]
fn a_calendar_review_says_its_drafts_are_events() {
    let parts = [presentation(
        &format!("review_{REVIEW}"),
        "macro_internal",
        review_input(REVIEW, "calendar"),
        ToolStatus::Completed,
    )];
    assert_eq!(
        segments(&parts, true)[0].rows[0].card,
        Some(ActivityCard::Review {
            review_id: REVIEW.to_owned(),
            drafts: ReviewDrafts::Calendar,
        })
    );
}

#[test]
fn only_a_finished_presentation_macro_wrote_for_its_review_is_a_card() {
    let presented = format!("review_{REVIEW}");
    let other = "0199f3a2-1b2c-7d4e-8f90-000000000000";
    let cases = [
        // Still being presented.
        presentation(
            &presented,
            "macro_internal",
            review_input(REVIEW, "email"),
            ToolStatus::Running,
        ),
        // A connected server that happens to have a tool by that name.
        presentation(
            &presented,
            "acme",
            review_input(REVIEW, "email"),
            ToolStatus::Completed,
        ),
        // Drafts of a kind this version does not know.
        presentation(
            &presented,
            "macro_internal",
            review_input(REVIEW, "task"),
            ToolStatus::Completed,
        ),
        // Not a review id.
        presentation(
            "review_not-a-review",
            "macro_internal",
            review_input("not-a-review", "email"),
            ToolStatus::Completed,
        ),
        // Named for another review than the one it carries.
        presentation(
            &presented,
            "macro_internal",
            review_input(other, "email"),
            ToolStatus::Completed,
        ),
    ];
    for part in cases {
        let rows = &segments(std::slice::from_ref(&part), true)[0].rows;
        assert_eq!(rows[0].card, None, "{part:?}");
    }
}

#[test]
fn a_presentation_is_worded_as_preparing_the_drafts() {
    let row = |status| {
        segments(
            &[presentation(
                "call_1",
                "macro_internal",
                review_input(REVIEW, "email"),
                status,
            )],
            false,
        )[0]
        .rows[0]
            .label
            .clone()
    };
    assert_eq!(row(ToolStatus::Running), "Preparing drafts to review");
    assert_eq!(row(ToolStatus::Completed), "Prepared drafts to review");
    assert_eq!(row(ToolStatus::Failed), "Couldn't prepare drafts to review");
}

const CHANNEL: &str = "0199f3a2-1b2c-7d4e-8f90-0000000c4a77";

fn code_run(activity: serde_json::Value) -> MessagePart {
    MessagePart::ToolUse {
        id: ToolUseId("code-1".into()),
        name: ToolName::Mcp {
            server: "macro_internal".into(),
            tool: "ExecuteCode".into(),
        },
        status: ToolStatus::Completed,
        detail: ToolDetail::Other {
            kind: "other".into(),
            input: Some(serde_json::json!({"source": "program"})),
            result: Some(serde_json::json!({"result": {"data": null}, "activity": activity})),
            output: None,
            error: None,
        },
    }
}

#[test]
fn a_code_run_cards_the_item_each_of_its_writes_changed() {
    let renamed = serde_json::json!({"type": "channel", "id": CHANNEL, "action": "renamed", "title": "launch"});
    let part = code_run(serde_json::json!([
        {"id": 1, "label": "Get Channels", "status": "completed"},
        {"id": 2, "label": "Patch Channel", "status": "completed", "item": renamed},
        {"id": 3, "label": "Patch Channel", "status": "failed", "item": renamed},
        {"id": 4, "label": "Create Task", "status": "completed",
         "item": {"type": "task", "id": CHANNEL, "action": "created"}},
    ]));
    let rows = &segments(std::slice::from_ref(&part), true)[0].rows;
    assert_eq!(
        rows.iter()
            .map(|row| row.card.is_some())
            .collect::<Vec<_>>(),
        [false, true, false, false]
    );
    assert_eq!(
        rows[1].card,
        Some(ActivityCard::Item {
            item_type: CardItemType::Channel,
            item_id: CHANNEL.to_owned(),
            file_type: None,
            action: CardAction::Renamed,
            title: Some("launch".to_owned()),
            summary: None,
        })
    );
    // An item this version cannot open still leaves its step.
    assert_eq!(rows[3].label, "Create Task");
    assert_eq!(rows[3].status, ActivityStatus::Completed);
}

#[test]
fn a_code_run_shows_the_view_it_returned_as_its_last_step() {
    let view = serde_json::json!({"widgets": [{"type": "md", "markdown": "Two found"}]});
    let receipt = |status: &str, activity: serde_json::Value| MessagePart::ToolUse {
        id: ToolUseId("code-1".into()),
        name: ToolName::Mcp {
            server: "macro_internal".into(),
            tool: "ExecuteCode".into(),
        },
        status: ToolStatus::Completed,
        detail: ToolDetail::Other {
            kind: "other".into(),
            input: Some(serde_json::json!({"source": "program"})),
            result: Some(serde_json::json!({
                "status": status,
                "result": {"data": null, "reviews": [], "view": view},
                "activity": activity,
            })),
            output: None,
            error: None,
        },
    };
    let read = serde_json::json!([{"id": 1, "label": "Search documents", "status": "completed"}]);
    let rows = &segments(&[receipt("succeeded", read.clone())], true)[0].rows;
    assert_eq!(
        rows.last(),
        Some(&ActivityRow {
            id: "code-1:view".into(),
            label: "Showed".into(),
            detail: None,
            status: ActivityStatus::Completed,
            card: Some(ActivityCard::View { view: view.clone() }),
        })
    );
    // A run with no SDK calls still shows what it returned.
    let rows = &segments(&[receipt("succeeded", serde_json::json!([]))], true)[0].rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "code-1:view");
    // Code mode failed the run: its view was not one the renderer draws.
    let rows = &segments(&[receipt("failed", read)], true)[0].rows;
    assert!(rows.iter().all(|row| row.card.is_none()));
}
