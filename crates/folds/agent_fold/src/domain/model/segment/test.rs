use std::path::PathBuf;

use super::*;
use crate::domain::model::{AgentRequestId, AnsiText, ToolUseId};

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
        permission(1, PermissionOutcome::Cancelled),
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
            }),
            Some(ActivityCard::Item {
                item_type: CardItemType::Document,
                item_id: "sheet-1".to_owned(),
                file_type: Some("spreadsheet".to_owned()),
                action: CardAction::Edited,
                title: None,
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
    let parts = [macro_tool(
        "a",
        "DisplayResults",
        serde_json::json!({"view": view.clone()}),
        ToolStatus::Completed,
    )];
    assert_eq!(
        segments(&parts, true)[0].rows[0].card,
        Some(ActivityCard::View { view })
    );
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
        })
    );
}

#[test]
fn humanize_keeps_acronyms_and_splits_every_convention() {
    assert_eq!(humanize("ListEntities"), "List entities");
    assert_eq!(humanize("read_document"), "Read document");
    assert_eq!(humanize("web-search"), "Web search");
    assert_eq!(humanize("FetchURL"), "Fetch URL");
    assert_eq!(humanize(""), "Tool");
}
