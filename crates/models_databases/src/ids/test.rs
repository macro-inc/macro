use super::*;

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
    assert_eq!(TableId::new().as_uuid().get_version_num(), 7);
}
