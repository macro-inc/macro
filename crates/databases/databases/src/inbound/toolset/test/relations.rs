use super::*;

#[test]
fn relation_schema_names_the_target_table() {
    let mut database = detail(AccessLevel::Owner);
    let target = Uuid::new_v4();
    let column = &mut database.tables[0].columns[0];
    column.definition.definition.data_type = DataType::Entity;
    column.definition.definition.is_multi_select = false;
    column.definition.definition.specific_entity_type =
        Some(models_properties::shared::EntityType::User);
    column.column.config = Some(ColumnConfig::Link {
        database_id: DATABASE_ID,
        table_id: TableId::from_uuid(target),
    });
    column.writable = false;
    let schema = serde_json::to_value(ToolDatabaseSchema::from(database)).unwrap();
    let column = &schema["tables"][0]["columns"][0];
    assert_eq!(column["isMultiSelect"], true);
    assert_eq!(column["writable"], false);
    assert!(column.get("specificEntityType").is_none());
    assert_eq!(
        column["relation"],
        serde_json::json!({
            "databaseId": DATABASE_ID,
            "tableId": target,
        })
    );
}
