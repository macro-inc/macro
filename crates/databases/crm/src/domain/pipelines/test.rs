use super::*;
use properties_types::DataType;

#[test]
fn creation_is_private_unless_requested_otherwise() {
    let input: CreatePipeline = serde_json::from_value(serde_json::json!({
        "name": "Renewals", "recordType": "company"
    }))
    .unwrap();
    assert_eq!(input.sharing, PipelineSharing::Private);
    assert_eq!(input.record_type, Some(PipelineRecordType::Company));
    assert_eq!(
        PipelineRecordType::Company.property_type(),
        PropertyEntityType::Company
    );
    assert_eq!(
        PipelineRecordType::Contact.property_type(),
        PropertyEntityType::Contact
    );
}

#[test]
fn a_pipeline_without_a_record_type_starts_like_a_new_database() {
    let input: CreatePipeline = serde_json::from_value(serde_json::json!({
        "name": "Hiring"
    }))
    .unwrap();
    let creator = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap();
    let blueprint = pipeline_blueprint(Uuid::nil(), creator, input, vec!["Lead".to_owned()]);
    assert_eq!(blueprint.record_type, None);
    let [name] = blueprint.database.columns.as_slice() else {
        panic!("a generic pipeline starts with one column");
    };
    assert_eq!(name.id, blueprint.primary_column_id);
    assert_eq!(name.name, "Name");
    assert_eq!(name.data_type, DataType::String);
    assert_eq!(name.entity_type, None);
    assert!(name.nullable);
    assert!(name.protections.is_empty());
}

#[test]
fn names_are_trimmed_and_limited_by_characters() {
    assert_eq!(name("  Renewals  ").unwrap(), "Renewals");
    assert!(name(" \n ").is_err());
    assert!(name(&"あ".repeat(200)).is_ok());
    assert!(name(&"あ".repeat(201)).is_err());
}
