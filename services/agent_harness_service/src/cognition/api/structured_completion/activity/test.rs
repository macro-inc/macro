use super::*;
use databases::domain::models::{ColumnId, TableId};
use databases_sql::SqlStatement;
use databases_sql::toolset::QueryDatabaseResponse;
use serde_json::json;
use std::collections::HashMap;
use uuid::Uuid;

const GUESTS: TableId =
    TableId::from_uuid(Uuid::from_u128(0x0e11_0000_0000_0000_0000_0000_0000_0001));
const STATUS: ColumnId =
    ColumnId::from_uuid(Uuid::from_u128(0x0e11_0000_0000_0000_0000_0000_0000_0002));

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
            json: serde_json::to_value(QueryDatabaseResponse {
                results: vec![],
                changes_applied: 0,
                inserted_row_ids: vec![],
                new_versions: HashMap::new(),
                read_versions: vec![],
                truncated_tables: vec![],
                statement: SqlStatement::Select,
                summary: "The statement ran and changed nothing.".into(),
            })
            .unwrap(),
            id: "2".into(),
        },
    ];
    let activity = tool_activity(&parts);
    assert_eq!(
        activity,
        vec![
            StructuredToolActivity {
                name: "CreateTable".into(),
                outcome: ToolOutcome::Failed,
            },
            StructuredToolActivity {
                name: "QueryDatabase".into(),
                outcome: ToolOutcome::Succeeded {
                    changes: DatabaseChange::None,
                },
            },
        ]
    );
    assert!(!has_database_changes(&activity));
}

#[test]
fn query_database_reports_the_rows_it_changed() {
    let activity = tool_activity(&[AssistantMessagePart::ToolCallResponseJson {
        name: "QueryDatabase".into(),
        json: serde_json::to_value(QueryDatabaseResponse {
            results: vec![],
            changes_applied: 2,
            inserted_row_ids: vec![],
            new_versions: HashMap::from([(GUESTS, 7)]),
            read_versions: vec![],
            truncated_tables: vec![],
            statement: SqlStatement::Update {
                table_id: GUESTS,
                table_name: "Guests".into(),
            },
            summary: "Applied 2 row changes.".into(),
        })
        .unwrap(),
        id: "1".into(),
    }]);
    assert_eq!(
        activity,
        vec![StructuredToolActivity {
            name: "QueryDatabase".into(),
            outcome: ToolOutcome::Succeeded {
                changes: DatabaseChange::Rows { count: 2 },
            },
        }]
    );
    assert!(has_database_changes(&activity));
}

#[test]
fn query_database_alter_column_is_a_schema_change() {
    let activity = tool_activity(&[AssistantMessagePart::ToolCallResponseJson {
        name: "QueryDatabase".into(),
        json: serde_json::to_value(QueryDatabaseResponse {
            results: vec![],
            changes_applied: 0,
            inserted_row_ids: vec![],
            new_versions: HashMap::from([(GUESTS, 8)]),
            read_versions: vec![],
            truncated_tables: vec![],
            statement: SqlStatement::AlterColumnType {
                table_id: GUESTS,
                table_name: "Guests".into(),
                column_id: STATUS,
                column_name: "Status".into(),
                to: "text".into(),
            },
            summary: "Changed \"Status\" to text.".into(),
        })
        .unwrap(),
        id: "1".into(),
    }]);
    assert_eq!(
        activity,
        vec![StructuredToolActivity {
            name: "QueryDatabase".into(),
            outcome: ToolOutcome::Succeeded {
                changes: DatabaseChange::Schema,
            },
        }]
    );
}

#[test]
fn every_mutating_database_tool_is_a_schema_change() {
    for name in ["SaveDatabaseView", "DeleteDatabaseView"] {
        let activity = tool_activity(&[AssistantMessagePart::ToolCallResponseJson {
            name: name.into(),
            json: json!({}),
            id: "1".into(),
        }]);
        assert_eq!(
            activity,
            vec![StructuredToolActivity {
                name: name.into(),
                outcome: ToolOutcome::Succeeded {
                    changes: DatabaseChange::Schema,
                },
            }],
            "{name}"
        );
    }
}

#[test]
fn discovery_saved_questions_and_other_tools_change_no_database() {
    for (name, response) in [
        ("ListDatabases", json!({})),
        ("DescribeDatabase", json!({})),
        (
            "SaveDatabaseQuery",
            json!({"queryId": "0e110000-0000-0000-0000-000000000001", "markdown": ""}),
        ),
        ("WebSearch", json!({})),
    ] {
        let activity = tool_activity(&[AssistantMessagePart::ToolCallResponseJson {
            name: name.into(),
            json: response,
            id: "1".into(),
        }]);
        assert_eq!(
            activity,
            vec![StructuredToolActivity {
                name: name.into(),
                outcome: ToolOutcome::Succeeded {
                    changes: DatabaseChange::None,
                },
            }],
            "{name}"
        );
    }
}

#[test]
fn sql_schema_receipts_are_decoded_and_report_schema_activity() {
    let response = QueryDatabaseResponse {
        results: vec![],
        changes_applied: 0,
        inserted_row_ids: vec![],
        new_versions: HashMap::new(),
        read_versions: vec![],
        truncated_tables: vec![],
        statement: SqlStatement::Schema {
            database_id: databases::domain::models::DatabaseId::new(),
            summary: "Created database".into(),
        },
        summary: "Created database".into(),
    };
    let json = serde_json::to_value(response).unwrap();
    let receipt = QueryDatabaseReceipt::deserialize(&json).unwrap();
    assert!(matches!(receipt.statement, ReceiptStatement::Schema));
    assert_eq!(query_database_change(&json), DatabaseChange::Schema);
}
