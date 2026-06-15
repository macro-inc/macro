use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn test_list_notifications_schema_validation() {
    let result = generate_validated_input_schema::<ListNotifications>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "ListNotifications",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("List the current user"),
        "Description should contain expected text"
    );
}

#[test]
fn test_list_notifications_deserialization() {
    // No parameters required
    let json = r#"{}"#;
    let tool: ListNotifications = serde_json::from_str(json).unwrap();
    assert_eq!(tool.limit, None);
    assert_eq!(tool.done, None);
    assert_eq!(tool.seen, None);
    assert_eq!(tool.include_types, None);
    assert_eq!(tool.entities, None);

    // With explicit filters
    let json = r#"{"limit": 10, "done": true, "seen": false, "includeTypes": ["email", "message", "github"], "entities": [{"entityType": "email", "id": "thread-1"}, {"entityType": "github", "id": "foreign-entity-1"}]}"#;
    let tool: ListNotifications = serde_json::from_str(json).unwrap();
    assert_eq!(tool.limit, Some(10));
    assert_eq!(tool.done, Some(true));
    assert_eq!(tool.seen, Some(false));
    assert_eq!(
        tool.include_types,
        Some(vec![
            NotificationItemType::Email,
            NotificationItemType::Message,
            NotificationItemType::Github
        ])
    );
    assert_eq!(
        tool.entities,
        Some(vec![
            NotificationEntityRef {
                entity_type: NotificationItemType::Email,
                id: "thread-1".to_string()
            },
            NotificationEntityRef {
                entity_type: NotificationItemType::Github,
                id: "foreign-entity-1".to_string()
            }
        ])
    );
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_list_notifications_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_list_notifications_input_schema() {
    let schema = generate_validated_input_schema::<ListNotifications>()
        .unwrap()
        .schema;
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_list_notifications_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_list_notifications_output_schema() {
    let schema = schemars::schema_for!(ListNotificationsResponse);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

#[test]
fn test_mark_notifications_seen_schema_validation() {
    let result = generate_validated_input_schema::<MarkNotificationsSeen>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "MarkNotificationsSeen",
        "Tool name should match the schemars title"
    );
    assert!(
        validated
            .description
            .contains("Mark one or more notifications as seen"),
        "Description should contain expected text"
    );
}

#[test]
fn test_mark_notifications_done_schema_validation() {
    let result = generate_validated_input_schema::<MarkNotificationsDone>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "MarkNotificationsDone",
        "Tool name should match the schemars title"
    );
    assert!(
        validated
            .description
            .contains("Mark one or more notifications as done"),
        "Description should contain expected text"
    );
}

#[test]
fn test_mark_notifications_seen_deserialization() {
    let json = r#"{"notificationIds": ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"]}"#;
    let tool: MarkNotificationsSeen = serde_json::from_str(json).unwrap();
    assert_eq!(tool.notification_ids.len(), 2);
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_mark_seen_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_mark_seen_input_schema() {
    let schema = generate_validated_input_schema::<MarkNotificationsSeen>()
        .unwrap()
        .schema;
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_mark_done_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_mark_done_input_schema() {
    let schema = generate_validated_input_schema::<MarkNotificationsDone>()
        .unwrap()
        .schema;
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_output_schema() {
    let schema = schemars::schema_for!(MarkNotificationsResponse);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
