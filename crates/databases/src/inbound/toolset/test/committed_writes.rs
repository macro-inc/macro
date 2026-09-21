use super::*;

fn failed_refresh() -> (Context, Arc<Mutex<Calls>>) {
    let service = FakeService {
        schema_error: true,
        ..FakeService::default()
    };
    let calls = service.calls.clone();
    (
        DatabasesToolContext::new(
            service,
            FakeAccess::granting(AccessLevel::Owner),
            FakeViews::default(),
        ),
        calls,
    )
}

fn assert_warning(warning: Option<String>) {
    let warning = warning.expect("a committed write explains the failed refresh");
    assert!(warning.contains("change was saved"));
    assert!(warning.contains("DescribeDatabase"));
    assert!(warning.contains(&DATABASE_ID.to_string()));
    assert!(warning.contains("do not repeat"));
}

#[tokio::test]
async fn creating_database_preserves_committed_identity_when_schema_read_fails() {
    let (context, calls) = failed_refresh();
    let response = CreateDatabase {
        name: "Offsite".into(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();
    assert_eq!(response.id, DATABASE_ID);
    assert_eq!(response.name, "Offsite");
    assert!(response.database.is_none());
    assert_warning(response.warning);
    assert_eq!(calls.lock().unwrap().created_databases, ["Offsite"]);
}

#[tokio::test]
async fn creating_database_preserves_success_when_followup_receipt_is_unavailable() {
    let (context, calls) = context(FakeAccess::denying());
    let response = CreateDatabase {
        name: "Offsite".into(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();
    assert_eq!(response.id, DATABASE_ID);
    assert!(response.database.is_none());
    assert_warning(response.warning);
    assert_eq!(calls.lock().unwrap().created_databases.len(), 1);
    assert_eq!(calls.lock().unwrap().described, 0);
}

#[tokio::test]
async fn committed_table_column_and_options_keep_ids_when_schema_refresh_fails() {
    let (context, calls) = failed_refresh();
    let table = CreateTable {
        database_id: DATABASE_ID,
        name: "Tickets".into(),
    }
    .call(ServiceContext(context.clone()), request_context())
    .await
    .unwrap();
    assert_eq!(table.database_id, DATABASE_ID);
    assert_eq!(table.table_id, TABLE_ID);
    assert!(table.database.is_none());
    assert_warning(table.warning);

    let column = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Status".into(),
        data_type: ColumnType::Select,
        is_multi_select: false,
        options: Some(vec!["Going".into()]),
        link_to_table_id: None,
    }
    .call(ServiceContext(context.clone()), request_context())
    .await
    .unwrap();
    assert_eq!(column.column_id, COLUMN_ID);
    assert_eq!(column.table_id, TABLE_ID);
    assert_eq!(column.database_id, DATABASE_ID);
    assert!(column.database.is_none());
    assert_warning(column.warning);

    let options = AddColumnOptions {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        column_id: COLUMN_ID,
        labels: vec!["Waitlisted".into()],
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();
    assert_eq!(options.database_id, DATABASE_ID);
    assert_eq!(options.table_id, TABLE_ID);
    assert_eq!(options.column_id, COLUMN_ID);
    assert_eq!(options.options, ["Going", "Declined", "Waitlisted"]);
    assert!(options.database.is_none());
    assert_warning(options.warning);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.created_tables, ["Tickets"]);
    assert_eq!(calls.created_columns.len(), 1);
    assert_eq!(calls.added_options.len(), 1);
}
