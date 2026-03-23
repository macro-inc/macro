use super::list_labels::build_summary;
use super::*;
use ai::generate_tool_input_schema;
use ai::tool::types::tool_object::validate_tool_schema;

#[test]
fn test_list_labels_schema_validation() {
    let schema = generate_tool_input_schema!(ListLabels);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "ListLabels",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("email labels"),
        "Description should contain expected text"
    );
}

#[test]
fn test_build_summary_empty() {
    let summary = build_summary(&[]);
    assert_eq!(summary, "No email labels found.");
}

#[test]
fn test_build_summary_with_labels() {
    let labels = vec![
        ToolLabel {
            id: uuid::Uuid::new_v4(),
            name: "INBOX".to_string(),
            type_: "system".to_string(),
        },
        ToolLabel {
            id: uuid::Uuid::new_v4(),
            name: "SENT".to_string(),
            type_: "system".to_string(),
        },
        ToolLabel {
            id: uuid::Uuid::new_v4(),
            name: "Work".to_string(),
            type_: "user".to_string(),
        },
    ];

    let summary = build_summary(&labels);
    assert!(summary.contains("2 system labels"));
    assert!(summary.contains("1 custom label"));
    assert!(summary.starts_with("Found"));
}

#[test]
fn test_update_thread_labels_schema_validation() {
    let schema = generate_tool_input_schema!(UpdateThreadLabels);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "UpdateThreadLabels",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("label"),
        "Description should contain expected text"
    );
}

#[test]
fn test_create_draft_schema_validation() {
    let schema = generate_tool_input_schema!(CreateDraft);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "CreateDraft",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("draft"),
        "Description should contain expected text"
    );
}

#[test]
fn test_get_thread_schema_validation() {
    let schema = generate_tool_input_schema!(GetThread);

    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, description) = result.unwrap();
    assert_eq!(
        name, "GetThread",
        "Tool name should match the schemars title"
    );
    assert!(
        description.contains("thread"),
        "Description should contain expected text"
    );
}

// run `cargo test -p email inbound::toolset::test::print_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_input_schema() {
    let schema = generate_tool_input_schema!(ListLabels);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
