use super::*;
use uuid::Uuid;

#[test]
fn an_id_is_its_uuid_string_on_the_wire() {
    let uuid = Uuid::from_u128(0x7ab1);
    let table = TableId::from_uuid(uuid);

    assert_eq!(
        serde_json::to_value(table).unwrap(),
        serde_json::json!(uuid.to_string())
    );
    assert_eq!(
        serde_json::from_value::<TableId>(serde_json::json!(uuid.to_string())).unwrap(),
        table
    );
    assert_eq!(table.to_string(), uuid.to_string());
    assert_eq!(uuid.to_string().parse::<TableId>().unwrap(), table);
}

#[test]
fn a_new_id_is_time_ordered() {
    assert_eq!(TableId::generate().as_uuid().get_version_num(), 7);
}

#[test]
fn the_openapi_schema_is_a_documented_uuid_string() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<TableId as ToSchema>::name(), "TableId");
    assert_eq!(
        serde_json::to_string(&<TableId as PartialSchema>::schema()).unwrap(),
        r#"{"type":"string","format":"uuid","description":"Identifier of one table (tab) within a database."}"#
    );
}

#[cfg(feature = "schema")]
#[test]
fn the_tool_schema_is_unchanged() {
    assert_eq!(
        serde_json::to_string(&schemars::schema_for!(TableId)).unwrap(),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Uuid","type":"string","format":"uuid"}"#
    );
}
