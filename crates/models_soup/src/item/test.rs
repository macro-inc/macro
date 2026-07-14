use super::*;
use crate::chat::SoupChat;
use macro_user_id::user_id::MacroUserIdStr;

#[derive(Debug, Serialize, Deserialize)]
struct TestPropertiesField {
    properties: Vec<String>,
}

fn raw_chat() -> SoupItem<()> {
    SoupItem::Chat(SoupChat {
        id: Uuid::nil(),
        name: "Test chat".to_string(),
        owner_id: MacroUserIdStr::try_from("macro|test@example.com".to_string()).unwrap(),
        project_id: None,
        is_persistent: true,
        created_at: DateTime::<Utc>::default(),
        updated_at: DateTime::<Utc>::default(),
        viewed_at: None,
        deleted_at: None,
        extra: (),
    })
}

#[test]
fn raw_extra_serializes_without_fields() {
    let value = serde_json::to_value(raw_chat()).unwrap();

    assert!(value["data"].get("extra").is_none());
    assert!(value["data"].get("properties").is_none());
}

#[test]
fn mapped_extra_is_flattened_into_the_item_data() {
    let item = raw_chat().map_extra(|()| TestPropertiesField {
        properties: vec!["priority".to_string()],
    });
    let value = serde_json::to_value(item).unwrap();

    assert_eq!(value["data"]["properties"], serde_json::json!(["priority"]));
    assert!(value["data"].get("extra").is_none());
}
