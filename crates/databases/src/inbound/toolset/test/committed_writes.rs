use models_databases::{ColumnChange, DatabaseOp, TableChange};

use super::*;

fn failed_refresh() -> (Context, Arc<Mutex<Calls>>) {
    let service = FakeService {
        schema_error: true,
        ..FakeService::default()
    };
    let calls = service.calls.clone();
    (
        DatabasesToolContext::new(service, FakeAccess::granting(AccessLevel::Owner)),
        calls,
    )
}

fn assert_warning(warning: Option<WriteWarnings>) {
    let warning = warning
        .expect("a committed write explains the failed refresh")
        .to_string();
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
        template: None,
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
        template: None,
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
    let created_table = match calls.lock().unwrap().applied[0].ops[0] {
        DatabaseOp::Table {
            table,
            change: TableChange::Create { .. },
        } => table,
        ref other => panic!("a table creation, got {other:?}"),
    };
    assert_eq!(table.table_id, created_table);
    assert!(table.database.is_none());
    assert_warning(table.warning);

    let column = AddColumn {
        database_id: DATABASE_ID,
        table_id: TABLE_ID,
        name: "Status".into(),
        data_type: ColumnType::Select,
        is_multi_select: false,
        options: Some(vec!["Going".into()]),
        specific_entity_type: None,
        link_to_table_id: None,
    }
    .call(ServiceContext(context.clone()), request_context())
    .await
    .unwrap();
    let created_column = match calls.lock().unwrap().applied[1].ops[0] {
        DatabaseOp::Column {
            column,
            change: ColumnChange::Create { .. },
            ..
        } => column,
        ref other => panic!("a column creation, got {other:?}"),
    };
    assert_eq!(column.column_id, created_column);
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
    assert!(
        options.options.is_empty(),
        "the labels come from the schema that could not be read"
    );
    assert!(options.database.is_none());
    assert_warning(options.warning);
    assert_eq!(calls.lock().unwrap().applied.len(), 3);
}

#[tokio::test]
async fn writes_reach_the_service_as_the_contexts_agent_for_the_user() {
    let agent = BotId::new_from_uuid(Uuid::from_u128(0x42));
    let (context, calls) = context(FakeAccess::granting(AccessLevel::Owner));
    let context = context.with_actor(agent);

    CreateDatabase {
        name: "Offsite".into(),
        template: None,
    }
    .call(ServiceContext(context.clone()), request_context())
    .await
    .unwrap();
    RenameDatabase {
        database_id: DATABASE_ID,
        name: "Party Planning".to_string(),
    }
    .call(ServiceContext(context.clone()), request_context())
    .await
    .unwrap();
    CreateTable {
        database_id: DATABASE_ID,
        name: "Tickets".into(),
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();

    assert_eq!(
        calls.lock().unwrap().acting_bots,
        [Some(agent), Some(agent), Some(agent)]
    );
}

#[tokio::test]
async fn a_template_reaches_the_service_with_the_creation() {
    use crate::domain::templates::TemplateId;

    let (context, calls) = context(FakeAccess::granting(AccessLevel::Owner));
    let response = CreateDatabase {
        name: "Launch".into(),
        template: Some(TemplateId::ProjectTracker),
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();
    assert_eq!(response.id, DATABASE_ID);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.created_databases, ["Launch"]);
    assert_eq!(calls.created_templates, [Some(TemplateId::ProjectTracker)]);
}

#[test]
fn the_tool_names_every_template_and_takes_its_slug() {
    use crate::domain::templates::{TEMPLATES, TemplateId};

    let schema = serde_json::to_value(schemars::schema_for!(CreateDatabase)).unwrap();
    let description = schema["description"].as_str().unwrap();
    for template in &TEMPLATES {
        assert!(
            description.contains(&format!("`{}`", template.id)),
            "the description names {}",
            template.id
        );
    }
    let tool: CreateDatabase = serde_json::from_value(serde_json::json!({
        "name": "Guests",
        "template": "event_planner",
    }))
    .unwrap();
    assert_eq!(tool.template, Some(TemplateId::EventPlanner));
    let blank: CreateDatabase =
        serde_json::from_value(serde_json::json!({"name": "Guests"})).unwrap();
    assert_eq!(blank.template, None);
}
