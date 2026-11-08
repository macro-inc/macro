use super::*;

#[test]
fn a_document_id_is_its_string_on_the_wire() {
    let id = DocumentId::parse("legacy-document-id").unwrap();
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""legacy-document-id""#);
    assert_eq!(serde_json::from_str::<DocumentId>(&json).unwrap(), id);
    assert_eq!(id.as_str(), "legacy-document-id");
    assert_eq!(id.to_string(), "legacy-document-id");
}

#[test]
fn empty_padded_and_control_character_ids_are_rejected() {
    for invalid in [
        "",
        " leading-space",
        "trailing-space ",
        "control\ncharacter",
    ] {
        assert_eq!(
            DocumentId::parse(invalid),
            Err(InvalidDocumentId),
            "{invalid:?}"
        );
        assert!(serde_json::from_value::<DocumentId>(serde_json::json!(invalid)).is_err());
    }
}

#[cfg(feature = "schema")]
#[test]
fn the_openapi_schema_is_unchanged() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<DocumentId as ToSchema>::name(), "DocumentId");
    assert_eq!(
        serde_json::to_string(&<DocumentId as PartialSchema>::schema()).unwrap(),
        r#"{"type":"string","description":"A validated document identifier. Historical document ids need not be UUIDs."}"#
    );
}

#[cfg(feature = "json-schema")]
#[test]
fn the_json_schema_is_unchanged() {
    assert_eq!(
        serde_json::to_value(schemars::schema_for!(DocumentId)).unwrap(),
        serde_json::json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "DocumentId",
            "description": "A validated document identifier. Historical document ids need not be UUIDs.",
            "type": "string"
        })
    );
}
