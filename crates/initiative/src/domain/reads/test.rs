use super::TaskInitiativeReference;

#[test]
fn task_reference_schema_matches_runtime_field_names() {
    let serialized = serde_json::to_value(TaskInitiativeReference::None {
        task_id: "task".into(),
    })
    .unwrap();
    assert_eq!(serialized["taskId"], "task");
    let schema =
        serde_json::to_value(<TaskInitiativeReference as utoipa::PartialSchema>::schema()).unwrap();
    let schema = schema.to_string();
    assert!(schema.contains("taskId"));
    assert!(!schema.contains("task_id"));
}
