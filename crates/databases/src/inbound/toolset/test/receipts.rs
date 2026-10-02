use models_databases::{ColumnChange, DatabaseOp, NewColumn, NewOption, TableChange};

use super::*;

#[tokio::test]
async fn describe_needs_a_view_receipt() {
    let (context, calls) = context(FakeAccess::denying());
    let error = DescribeDatabase {
        database_id: DATABASE_ID,
        include_editing_metadata: true,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("no access means no schema");

    assert!(
        error
            .description
            .contains("does not have permission to read"),
        "{}",
        error.description
    );
    assert_eq!(
        calls.lock().unwrap().described,
        0,
        "the service must not be reached without a receipt"
    );
}

/// View access reads; it does not create tables. The receipt type is what
/// draws that line, and it is drawn before the service is touched.
#[tokio::test]
async fn creating_a_table_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = CreateTable {
        database_id: DATABASE_ID,
        name: "Sessions".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot change the schema");

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
async fn renaming_a_table_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = RenameTable {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Attendees".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot rename a tab");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

/// The service's compare-and-swap needs the name being replaced; the tool
/// supplies the current one rather than asking the model to repeat it.
#[tokio::test]
async fn renaming_a_table_replaces_its_current_name() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = RenameTable {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Attendees".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may rename a tab");

    assert_eq!(response.table_id, TABLE_ID);
    assert_eq!(response.name, "Attendees");
    assert!(response.database.is_some());
    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::Table {
            table: TABLE_ID,
            change: TableChange::Rename {
                name: "Attendees".to_string(),
                previous_name: Some("Guests".to_string()),
            },
        }])]
    );
}

#[tokio::test]
async fn renaming_an_unknown_table_points_at_describe() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let error = RenameTable {
        database_id: DATABASE_ID,
        table_id: TableId::from_uuid(Uuid::nil()),
        name: "Attendees".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("the table is not in this database");

    assert!(
        error.description.contains("DescribeDatabase"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn creating_a_table_with_edit_access_succeeds() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = CreateTable {
        database_id: DATABASE_ID,
        name: "Sessions".to_string(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may add a tab");

    let calls = calls.lock().unwrap();
    let [batch] = calls.applied.as_slice() else {
        panic!("one batch, got {:?}", calls.applied);
    };
    let DatabaseOp::Table { table: id, .. } = batch.ops[0] else {
        panic!("a table creation, got {:?}", batch.ops);
    };
    assert_eq!(
        *batch,
        OpBatch::from(vec![DatabaseOp::Table {
            table: id,
            change: TableChange::Create {
                name: "Sessions".to_string(),
            },
        }])
    );
    assert_eq!(response.table_id, id, "the response names the minted table");
    assert_eq!(
        response.database.expect("schema refresh succeeds").tables[0].sql_name,
        "\"Offsite\".\"Guests\"",
        "the SQL name is the display name, quoted"
    );
}

#[tokio::test]
async fn adding_a_column_needs_more_than_view_access() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::View));
    let error = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Dietary Needs".to_string(),
        data_type: ColumnType::Select,
        is_multi_select: true,
        options: Some(vec!["Vegan".to_string()]),
        specific_entity_type: None,
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("view access cannot change the schema");

    assert!(
        error
            .description
            .contains("does not have permission to edit"),
        "{}",
        error.description
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

/// The tool's vocabulary has to reach the property system unchanged, or a
/// column is created as one type and read back as another.
#[tokio::test]
async fn adding_a_column_passes_the_type_through() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Dietary Needs".to_string(),
        data_type: ColumnType::Select,
        is_multi_select: true,
        options: Some(vec!["Vegan".to_string(), "Gluten-free".to_string()]),
        specific_entity_type: None,
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("edit access may add a column");

    let calls = calls.lock().unwrap();
    let [batch] = calls.applied.as_slice() else {
        panic!("one batch, got {:?}", calls.applied);
    };
    let DatabaseOp::Column {
        column: id,
        change:
            ColumnChange::Create {
                definition: NewColumn::New { options, .. },
                ..
            },
        ..
    } = &batch.ops[0]
    else {
        panic!("a new column, got {:?}", batch.ops);
    };
    assert_eq!(
        *batch,
        OpBatch::from(vec![DatabaseOp::Column {
            table: TABLE_ID,
            column: *id,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Dietary Needs".to_string(),
                    kind: ColumnKind::Select { multi: true },
                    options: vec![
                        NewOption {
                            id: options[0].id,
                            label: "Vegan".to_string(),
                        },
                        NewOption {
                            id: options[1].id,
                            label: "Gluten-free".to_string(),
                        },
                    ],
                    infer_type: false,
                },
                after: None,
            },
        }])
    );
    assert_ne!(options[0].id, options[1].id, "each option mints its own id");
    assert_eq!(
        response.column_id, *id,
        "the response names the minted column"
    );
}

#[tokio::test]
async fn adding_a_people_column_names_the_entity_kind() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let response = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Host".to_string(),
        data_type: ColumnType::Entity,
        is_multi_select: false,
        options: None,
        specific_entity_type: Some(ToolEntityType::User),
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("an entity column names what it references");

    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::Column {
            table: TABLE_ID,
            column: response.column_id,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Host".to_string(),
                    kind: ColumnKind::Entity {
                        target: models_databases::EntityKind::User,
                        multi: false,
                    },
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }])]
    );
}

#[tokio::test]
async fn an_entity_column_without_its_kind_is_refused_before_the_service() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let error = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Host".to_string(),
        data_type: ColumnType::Entity,
        is_multi_select: false,
        options: None,
        specific_entity_type: None,
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("an entity column must say what it references");

    assert_eq!(
        error.description,
        "An entity column needs specificEntityType, what its ids reference: USER for people, \
         DOCUMENT, TASK and so on."
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn an_entity_kind_on_another_type_is_refused_before_the_service() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let error = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Host".to_string(),
        data_type: ColumnType::Text,
        is_multi_select: false,
        options: None,
        specific_entity_type: Some(ToolEntityType::User),
        link_to_table_id: None,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("only an entity column references an entity kind");

    assert_eq!(
        error.description,
        "specificEntityType is only for dataType entity; for a person column pass dataType \
         entity with specificEntityType USER, or leave specificEntityType out."
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn an_entity_kind_on_a_relation_is_refused_before_the_service() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let parties = TableId::from_uuid(Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0002));
    let error = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Party".to_string(),
        data_type: ColumnType::Entity,
        is_multi_select: false,
        options: None,
        specific_entity_type: Some(ToolEntityType::User),
        link_to_table_id: Some(parties),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("a relation references rows, not an entity kind");

    assert_eq!(
        error.description,
        "A relation column references rows of linkToTableId; leave specificEntityType out."
    );
    assert!(calls.lock().unwrap().applied.is_empty());
}

/// A relation is an entity column with a target table, in this database.
#[tokio::test]
async fn adding_a_relation_column_targets_this_database() {
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Edit));
    let parties = TableId::from_uuid(Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0002));
    let response = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Party".to_string(),
        data_type: ColumnType::Entity,
        is_multi_select: false,
        options: None,
        specific_entity_type: None,
        link_to_table_id: Some(parties),
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect("a relation needs no entity kind");

    assert_eq!(
        calls.lock().unwrap().applied,
        vec![OpBatch::from(vec![DatabaseOp::Column {
            table: TABLE_ID,
            column: response.column_id,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Party".to_string(),
                    kind: ColumnKind::Relation {
                        database: DATABASE_ID,
                        table: parties,
                    },
                    options: vec![],
                    infer_type: false,
                },
                after: None,
            },
        }])]
    );
}

#[test]
fn column_types_round_trip_through_the_property_system() {
    for column_type in [
        ColumnType::Text,
        ColumnType::Number,
        ColumnType::Boolean,
        ColumnType::Date,
        ColumnType::Link,
        ColumnType::Select,
        ColumnType::SelectNumber,
        ColumnType::Tag,
        ColumnType::Entity,
    ] {
        let stored: DataType = column_type.into();
        assert_eq!(
            ColumnType::from(stored),
            column_type,
            "{column_type:?} did not round trip"
        );
    }
}
