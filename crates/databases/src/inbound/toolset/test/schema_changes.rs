use models_databases::{ColumnChange, DatabaseOp, NewOption, TableChange};

use super::*;

/// The service's compare-and-swap needs the label being replaced; the tool
/// reads it rather than asking the model to repeat it.
#[tokio::test]
async fn renaming_a_column_replaces_its_current_label() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = RenameColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        name: " RSVP ".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may rename a column");

    assert_eq!(response.column_id, COLUMN_ID);
    assert_eq!(response.name, "RSVP");
    assert!(response.database.is_some());
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::Column {
            table: TABLE_ID,
            column: COLUMN_ID,
            change: ColumnChange::Rename {
                name: " RSVP ".to_string(),
                previous_name: Some("Status".to_string()),
            },
        }])]
    );
}

#[tokio::test]
async fn renaming_an_unknown_column_points_at_describe() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let error = RenameColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: ColumnId::from_uuid(Uuid::nil()),
        name: "RSVP".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("the column is not in this table");

    assert!(
        error.description.contains("DescribeDatabase"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

/// The model never passes a version: the tool converts against the version it
/// just read, and adds the labels no row has yet in the same batch.
#[tokio::test]
async fn changing_a_column_type_uses_the_current_version_and_adds_extra_options() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = ChangeColumnType {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        data_type: ColumnType::Select,
        is_multi_select: false,
        options: Some(vec!["Waitlisted".to_string()]),
        specific_entity_type: None,
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may change a column's type");

    assert_eq!(response.column_id, COLUMN_ID);
    assert!(response.database.is_some());
    assert!(response.warning.is_none());
    let calls = calls.lock().unwrap();
    let [batch] = calls.applied.as_slice() else {
        panic!("one batch, got {:?}", calls.applied);
    };
    let DatabaseOp::Column {
        change: ColumnChange::AddOptions { options },
        ..
    } = &batch.ops[1]
    else {
        panic!("the options follow the change, got {:?}", batch.ops);
    };
    assert_eq!(
        *batch,
        OpBatch {
            ops: vec![
                DatabaseOp::Column {
                    table: TABLE_ID,
                    column: COLUMN_ID,
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Select { multi: false },
                    },
                },
                DatabaseOp::Column {
                    table: TABLE_ID,
                    column: COLUMN_ID,
                    change: ColumnChange::AddOptions {
                        options: vec![NewOption {
                            id: options[0].id,
                            label: "Waitlisted".to_string(),
                        }],
                    },
                },
            ],
            base_versions: HashMap::from([(TABLE_ID, TableVersion(3))]),
        }
    );
}

#[tokio::test]
async fn changing_a_column_to_a_relation_targets_this_database() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let parties = TableId::from_uuid(Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0002));
    ChangeColumnType {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        data_type: ColumnType::Entity,
        is_multi_select: false,
        options: None,
        specific_entity_type: None,
        link_to_table_id: Some(parties),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("a relation is an entity column with a target table");

    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch {
            ops: vec![DatabaseOp::Column {
                table: TABLE_ID,
                column: COLUMN_ID,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Relation {
                        database: DATABASE_ID,
                        table: parties,
                    },
                },
            }],
            base_versions: HashMap::from([(TABLE_ID, TableVersion(3))]),
        }]
    );
}

#[tokio::test]
async fn changing_a_column_to_people_names_the_entity_kind() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    ChangeColumnType {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        data_type: ColumnType::Entity,
        is_multi_select: true,
        options: Some(vec![]),
        specific_entity_type: Some(ToolEntityType::User),
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("an entity column names what it references");

    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch {
            ops: vec![DatabaseOp::Column {
                table: TABLE_ID,
                column: COLUMN_ID,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Entity {
                        target: models_databases::EntityKind::User,
                        multi: true,
                    },
                },
            }],
            base_versions: HashMap::from([(TABLE_ID, TableVersion(3))]),
        }]
    );
}

#[test]
fn entity_kinds_reach_the_property_system_by_their_stored_names() {
    let parsed: ChangeColumnType = serde_json::from_value(serde_json::json!({
        "databaseId": DATABASE_ID,
        "tableId": TABLE_ID,
        "columnId": COLUMN_ID,
        "dataType": "entity",
        "specificEntityType": "CALENDAR_EVENT",
    }))
    .unwrap();
    assert_eq!(
        parsed
            .specific_entity_type
            .map(models_properties::EntityType::from),
        Some(models_properties::EntityType::CalendarEvent)
    );
    assert!(
        serde_json::from_value::<ChangeColumnType>(serde_json::json!({
            "databaseId": DATABASE_ID,
            "tableId": TABLE_ID,
            "columnId": COLUMN_ID,
            "dataType": "entity",
            "specificEntityType": "DATABASE_ROW",
        }))
        .is_err(),
        "relations are made with linkToTableId"
    );
}

#[tokio::test]
async fn deleting_a_column_guards_on_the_version_just_read() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = DeleteColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may delete a column");

    assert_eq!(response.column_id, COLUMN_ID);
    assert!(response.database.is_some());
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch {
            ops: vec![DatabaseOp::Column {
                table: TABLE_ID,
                column: COLUMN_ID,
                change: ColumnChange::Delete,
            }],
            base_versions: HashMap::from([(TABLE_ID, TableVersion(3))]),
        }]
    );
}

#[tokio::test]
async fn reordering_columns_guards_on_the_version_just_read() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = ReorderColumns {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_ids: vec![COLUMN_ID],
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may reorder columns");

    assert_eq!(response.table_id, TABLE_ID);
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch {
            ops: vec![DatabaseOp::Table {
                table: TABLE_ID,
                change: TableChange::ReorderColumns {
                    order: vec![COLUMN_ID],
                },
            }],
            base_versions: HashMap::from([(TABLE_ID, TableVersion(3))]),
        }]
    );
}

#[tokio::test]
async fn reordering_tables_passes_the_full_order_and_answers_the_schema() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let other_table = TableId::from_uuid(Uuid::from_u128(0x7ab1e));
    let response = ReorderTables {
        database_id: DATABASE_ID,
        table_ids: vec![other_table, TABLE_ID],
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may reorder tables");

    assert_eq!(response.table_ids, vec![other_table, TABLE_ID]);
    assert!(response.database.is_some());
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::ReorderTables {
            order: vec![other_table, TABLE_ID],
        }])]
    );
}

#[tokio::test]
async fn reordering_tables_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = ReorderTables {
        database_id: DATABASE_ID,
        table_ids: vec![TABLE_ID],
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot reorder tabs");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn deleting_a_table_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = DeleteTable {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot delete a tab");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn deleting_a_table_returns_the_schema_after_it() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = DeleteTable {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may delete a tab");

    assert_eq!(response.table_id, TABLE_ID);
    assert!(response.database.is_some());
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::Table {
            table: TABLE_ID,
            change: TableChange::Delete,
        }])]
    );
}

#[tokio::test]
async fn renaming_a_database_returns_its_new_name() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = RenameDatabase {
        database_id: DATABASE_ID,
        name: "Party Planning".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may rename a database");

    assert_eq!(response.database_id, DATABASE_ID);
    assert_eq!(response.name, "Party Planning");
    assert!(response.database.is_some());
    assert_eq!(
        calls.lock().unwrap().renamed_databases,
        vec!["Party Planning".to_string()]
    );
}

#[tokio::test]
async fn describing_a_column_lists_the_types_it_can_change_to() {
    let (context, _) = context(FakeAccess::granting(AccessLevel::View));
    let schema = DescribeDatabase {
        database_id: DATABASE_ID,
        include_editing_metadata: true,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("view access describes");

    let status = &schema.tables[0].columns[0];
    assert_eq!(
        serde_json::to_value(&status.safe_types).unwrap(),
        serde_json::json!(["text", "select[]"])
    );
    assert_eq!(
        serde_json::to_value(&status.checked_types).unwrap(),
        serde_json::json!(["number", "date", "boolean", "link"])
    );
}
