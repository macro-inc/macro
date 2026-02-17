use super::*;
use ai::generate_tool_input_schema;
use ai::tool::types::tool_object::validate_tool_schema;

#[test]
fn test_mark_notifications_seen_schema_validation() {
    let schema = generate_tool_input_schema!(MarkNotificationsSeen);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "MarkNotificationsSeen",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("Mark one or more notifications as seen"),
        "Description should contain expected text"
    );
}

#[test]
fn test_mark_notifications_done_schema_validation() {
    let schema = generate_tool_input_schema!(MarkNotificationsDone);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "MarkNotificationsDone",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("Mark one or more notifications as done"),
        "Description should contain expected text"
    );
}

#[test]
fn test_mark_notifications_done_default_values() {
    // Test that done defaults to true when not specified
    let json = r#"{"notificationIds": ["550e8400-e29b-41d4-a716-446655440000"]}"#;
    let tool: MarkNotificationsDone = serde_json::from_str(json).unwrap();
    assert!(tool.done, "done should default to true");
    assert_eq!(tool.notification_ids.len(), 1);

    // Test explicit false
    let json = r#"{"notificationIds": ["550e8400-e29b-41d4-a716-446655440000"], "done": false}"#;
    let tool: MarkNotificationsDone = serde_json::from_str(json).unwrap();
    assert!(!tool.done, "done should be false when explicitly set");
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
    let schema = generate_tool_input_schema!(MarkNotificationsSeen);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_mark_done_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_mark_done_input_schema() {
    let schema = generate_tool_input_schema!(MarkNotificationsDone);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p notification --features ai_tool inbound::ai_tool::test::print_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_output_schema() {
    let generator = ai::tool::minimized_output_schema_generator();
    let schema = generator.into_root_schema_for::<MarkNotificationsResponse>();
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
