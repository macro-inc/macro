use super::*;

#[test]
fn creation_is_private_unless_requested_otherwise() {
    let input: CreatePipeline = serde_json::from_value(serde_json::json!({
        "name": "Renewals", "recordType": "company"
    }))
    .unwrap();
    assert_eq!(input.sharing, PipelineSharing::Private);
    assert_eq!(
        input.record_type.property_type(),
        PropertyEntityType::Company
    );
    assert_eq!(
        PipelineRecordType::Contact.property_type(),
        PropertyEntityType::Contact
    );
}

#[test]
fn names_are_trimmed_and_limited_by_characters() {
    assert_eq!(name("  Renewals  ").unwrap(), "Renewals");
    assert!(name(" \n ").is_err());
    assert!(name(&"あ".repeat(200)).is_ok());
    assert!(name(&"あ".repeat(201)).is_err());
}
