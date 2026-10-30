use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn tool_schemas_are_valid() {
    assert_eq!(
        generate_validated_input_schema::<RequestEntityAccess>()
            .unwrap()
            .name,
        "RequestEntityAccess"
    );
    assert_eq!(
        generate_validated_input_schema::<ReadEntityAccessRequest>()
            .unwrap()
            .name,
        "ReadEntityAccessRequest"
    );
}

#[test]
fn ownership_is_not_requestable() {
    let owner = serde_json::from_value::<RequestEntityAccess>(serde_json::json!({
        "entityType": "initiative",
        "entityId": "00000000-0000-0000-0000-000000000010",
        "access": "owner"
    }));
    assert!(owner.is_err());
}

#[test]
fn legacy_chats_are_not_advertised() {
    let chat = serde_json::from_value::<RequestEntityAccess>(serde_json::json!({
        "entityType": "chat",
        "entityId": "00000000-0000-0000-0000-000000000010",
        "access": "edit"
    }));
    assert!(chat.is_err());
}
