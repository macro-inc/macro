use super::*;
use serde_json::json;

#[test]
fn only_successful_tool_results_acknowledge_changes() {
    let parts = vec![
        AssistantMessagePart::Text {
            text: "Created a table".into(),
        },
        AssistantMessagePart::ToolCall {
            name: "CreateTable".into(),
            json: json!({}),
            id: "1".into(),
        },
        AssistantMessagePart::ToolCallErr {
            name: "CreateTable".into(),
            description: "denied".into(),
            id: "1".into(),
        },
        AssistantMessagePart::ToolCallResponseJson {
            name: "QueryDatabase".into(),
            json: json!({"changesApplied": 0}),
            id: "2".into(),
        },
    ];
    let activity = tool_activity(&parts);
    assert_eq!(activity.len(), 2);
    assert!(!has_database_changes(&activity));
    assert!(!activity[0].success);
    assert_eq!(activity[1].changes_applied, Some(0));
}

#[test]
fn tracks_committed_row_schema_and_view_changes() {
    for (name, result) in [
        ("QueryDatabase", json!({"changesApplied": 2})),
        ("CreateDatabase", json!({})),
        ("CreateTable", json!({})),
        ("AddColumn", json!({})),
        ("AddColumnOptions", json!({})),
        ("SaveDatabaseView", json!({})),
    ] {
        let activity = tool_activity(&[AssistantMessagePart::ToolCallResponseJson {
            name: name.into(),
            json: result,
            id: "1".into(),
        }]);
        assert!(has_database_changes(&activity), "{name}");
    }
}
