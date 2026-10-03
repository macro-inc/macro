use super::*;

#[tokio::test]
async fn listing_renders_the_grant() {
    let (context, _) = context(FakeAccess::granting(AccessLevel::Owner));
    let response = ListDatabases {}
        .call(ServiceContext(context), request_context())
        .await
        .expect("listing needs no receipt");

    assert_eq!(response.databases.len(), 1);
    assert_eq!(response.databases[0].grant, ToolGrant::Owner);
    assert_eq!(response.databases[0].name, "Offsite");
    assert_eq!(response.databases[0].tables[0].name, "Guests");
    assert_eq!(response.databases[0].tables[0].id, TABLE_ID);
    assert_eq!(
        response.databases[0].tables[0].sql_name,
        "\"Offsite\".\"Guests\""
    );
    assert_eq!(response.summary, "Found 1 database.");
}

#[test]
fn an_empty_list_says_so_rather_than_looking_like_a_failure() {
    assert!(list_databases::summarize(&[]).contains("No accessible databases"));
}

/// Select options reach the model as the labels SQL accepts, and with the
/// ids a view names them by.
#[test]
fn describing_a_database_renders_option_labels() {
    let schema = ToolDatabaseSchema::from(detail(AccessLevel::Owner));

    assert_eq!(schema.tables[0].sql_name, "\"Offsite\".\"Guests\"");
    assert_eq!(schema.tables[0].version, 3);
    assert!(schema.tables[0].writable);
    let column = &schema.tables[0].columns[0];
    assert_eq!(column.sql_name, "\"Status\"");
    assert_eq!(column.data_type, ColumnType::Select);
    let labels: Vec<&str> = column
        .options
        .iter()
        .map(|option| option.label.as_str())
        .collect();
    assert_eq!(labels, vec!["Going", "Declined"]);
    let detail = detail(AccessLevel::Owner);
    let ids: Vec<Uuid> = column
        .options
        .iter()
        .map(|option| option.id.into_uuid())
        .collect();
    let stored: Vec<Uuid> = detail.tables[0].columns[0]
        .definition
        .property_options
        .iter()
        .map(|option| option.id)
        .collect();
    assert_eq!(ids.len(), stored.len());
}

#[test]
fn describing_a_renamed_column_supplies_its_current_label_as_the_sql_identifier() {
    let mut database = detail(AccessLevel::Owner);
    database.tables[0].columns[0].column.display_name = Some("RSVP".into());
    database.tables[0].columns[0].sql_name = "\"RSVP\"".into();
    let schema = ToolDatabaseSchema::from(database);
    let column = &schema.tables[0].columns[0];
    assert_eq!(column.name, "RSVP");
    assert_eq!(column.sql_name, "\"RSVP\"");
    let labels: Vec<&str> = column
        .options
        .iter()
        .map(|option| option.label.as_str())
        .collect();
    assert_eq!(labels, vec!["Going", "Declined"]);
}

#[test]
fn describing_an_entity_column_preserves_the_actual_entity_kind() {
    let mut database = detail(AccessLevel::Owner);
    let definition = &mut database.tables[0].columns[0].definition.definition;
    definition.data_type = DataType::Entity;
    definition.specific_entity_type = Some(models_properties::shared::EntityType::User);
    let json = serde_json::to_value(ToolDatabaseSchema::from(database)).unwrap();
    assert_eq!(
        json["tables"][0]["columns"][0]["specificEntityType"],
        "USER"
    );
    assert_eq!(json["tables"][0]["columns"][0]["dataType"], "entity");
}

/// A view-only grant has to read as unwritable, or the model writes an UPDATE
/// that the executor rejects after the user has been promised an edit.
#[test]
fn a_view_only_database_reads_as_unwritable() {
    let schema = ToolDatabaseSchema::from(detail(AccessLevel::View));
    assert_eq!(schema.grant, ToolGrant::View);
    assert!(!schema.tables[0].writable);
}

#[test]
fn the_response_serializes_with_camel_case_keys() {
    let schema = ToolDatabaseSchema::from(detail(AccessLevel::Owner));
    let json = serde_json::to_value(&schema).expect("schema should serialize");

    assert!(json["tables"][0]["sqlName"].is_string());
    assert!(json["tables"][0]["columns"][0]["isMultiSelect"].is_boolean());
}

#[test]
fn a_version_conflict_tells_the_model_to_describe_and_retry() {
    let error = database_error(DatabaseError::VersionConflict);
    assert_eq!(
        error.description,
        "The table changed since it was described. Call DescribeDatabase for its current \
         schema and version, then retry."
    );
}

#[tokio::test]
async fn describe_is_compact_by_default_and_editing_metadata_is_opt_in() {
    let (context, _) = context(FakeAccess::granting(AccessLevel::Owner));
    let concise: DescribeDatabase =
        serde_json::from_value(serde_json::json!({"databaseId": DATABASE_ID})).unwrap();
    assert!(!concise.include_editing_metadata);
    let compact = concise
        .call(ServiceContext(context.clone()), request_context())
        .await
        .unwrap();
    let detailed = DescribeDatabase {
        database_id: DATABASE_ID,
        include_editing_metadata: true,
    }
    .call(ServiceContext(context), request_context())
    .await
    .unwrap();
    let json = serde_json::to_value(&compact).unwrap();
    let column = &json["tables"][0]["columns"][0];
    assert!(column.get("safeTypes").is_none());
    assert!(column.get("checkedTypes").is_none());
    assert!(column.get("options").is_some());
    assert!(column.get("id").is_some());
    assert!(
        serde_json::to_string(&compact).unwrap().len()
            < serde_json::to_string(&detailed).unwrap().len()
    );
}
