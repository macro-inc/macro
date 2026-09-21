use super::*;

#[test]
fn relation_schema_preserves_target_and_exact_junction_names() {
    let mut database = detail(AccessGrant::Owner);
    let target = Uuid::new_v4();
    let column = &mut database.tables[0].columns[0];
    column.definition.definition.data_type = DataType::Entity;
    column.definition.definition.is_multi_select = false;
    column.definition.definition.specific_entity_type =
        Some(models_properties::shared::EntityType::User);
    column.column.config = Some(ColumnConfig::Link {
        database_id: DATABASE_ID,
        table_id: target,
    });
    column.writable = false;
    column.junction_sql_name = Some("_macro_storage_junction_collision".into());
    column.read_junction_sql_name = Some("_macro_table_source__customer".into());
    column.junction_writable = true;
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
            "junctionSqlName": "_macro_storage_junction_collision",
            "readJunctionSqlName": "_macro_table_source__customer",
            "writable": true,
        })
    );
}
