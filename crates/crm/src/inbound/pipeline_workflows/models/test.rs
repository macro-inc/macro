use super::*;

#[test]
fn a_pipeline_request_carries_its_stages_and_fields_into_the_workflow() {
    let request: CreatePipelineRequest = serde_json::from_value(serde_json::json!({
        "name": "Hiring",
        "recordType": "contact",
        "sharing": "team",
        "stages": ["Sourced", "Screen", "Offer"],
        "fields": [
            { "name": "Role", "type": "text" },
            { "name": "Level", "type": "select", "options": ["Junior", "Senior"] },
        ],
    }))
    .unwrap();
    assert_eq!(request.record_type, Some(PipelineRecordType::Contact));
    assert_eq!(request.sharing, PipelineSharing::Team);
    assert_eq!(request.stages, ["Sourced", "Screen", "Offer"]);
    let fields: Vec<NewField> = request.fields.iter().map(Into::into).collect();
    assert_eq!(fields[1].name, "Level");
    assert_eq!(fields[1].kind, NewFieldKind::Select);
    assert_eq!(fields[1].options, ["Junior", "Senior"]);
}

#[test]
fn a_pipeline_request_defaults_to_a_private_generic_pipeline_with_default_stages() {
    let request: CreatePipelineRequest =
        serde_json::from_value(serde_json::json!({ "name": "Ideas" })).unwrap();
    assert_eq!(request.record_type, None);
    assert_eq!(request.sharing, PipelineSharing::Private);
    assert!(request.stages.is_empty());
    assert!(request.fields.is_empty());
}
