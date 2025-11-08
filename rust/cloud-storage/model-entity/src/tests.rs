use crate::{EntityType, UserEntityConnection};
use serde_json::{Value, json};

fn get_json() -> Value {
    json!({
        "user_id": "myuser",
        "connection_id": "my_connection_id",
        "entity_id": "my_entity_id",
        "entity_type": "document"
    })
}

#[test]
fn it_should_deserialize_user_entity_connection() {
    let obj = get_json();
    let _res = serde_json::from_value::<UserEntityConnection<'static>>(obj).unwrap();
}

#[test]
fn it_should_serialize_user_entity_connection() {
    let conn = EntityType::Document
        .with_entity_str("my_entity_id")
        .with_connection_str("my_connection_id")
        .with_user_str("myuser");

    assert_eq!(serde_json::to_value(&conn).unwrap(), get_json());
}
