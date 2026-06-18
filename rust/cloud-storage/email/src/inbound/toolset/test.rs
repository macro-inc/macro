use super::list_labels::build_summary;
use super::*;
use ai_toolset::schema::generate_validated_input_schema;

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
    let result = generate_validated_input_schema::<UpdateThreadLabels>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "UpdateThreadLabels",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("label"),
        "Description should contain expected text"
    );
}

#[test]
fn test_send_email_schema_validation() {
    let result = generate_validated_input_schema::<SendEmail>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "SendEmail",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("send"),
        "Description should contain expected text"
    );
}

#[test]
fn test_get_thread_schema_validation() {
    let result = generate_validated_input_schema::<GetThread>();
    assert!(result.is_ok(), "{:?}", result);

    let validated = result.unwrap();
    assert_eq!(
        validated.name, "GetThread",
        "Tool name should match the schemars title"
    );
    assert!(
        validated.description.contains("thread"),
        "Description should contain expected text"
    );
}
