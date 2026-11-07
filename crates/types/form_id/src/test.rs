use super::*;
use uuid::Uuid;

#[test]
fn an_id_is_its_uuid_string_on_the_wire() {
    let uuid = Uuid::from_u128(0xf0a1);
    let form = FormId::from_uuid(uuid);

    assert_eq!(
        serde_json::to_value(form).unwrap(),
        serde_json::json!("00000000-0000-0000-0000-00000000f0a1")
    );
    assert_eq!(
        serde_json::from_value::<FormId>(serde_json::json!("00000000-0000-0000-0000-00000000f0a1"))
            .unwrap(),
        form
    );
    assert_eq!(form.to_string(), "00000000-0000-0000-0000-00000000f0a1");
    assert_eq!(
        "00000000-0000-0000-0000-00000000f0a1"
            .parse::<FormId>()
            .unwrap(),
        form
    );
}

#[test]
fn a_new_id_is_time_ordered() {
    assert_eq!(FormId::generate().as_uuid().get_version_num(), 7);
    assert_eq!(FormSectionId::generate().as_uuid().get_version_num(), 7);
    assert_eq!(FormQuestionId::generate().as_uuid().get_version_num(), 7);
    assert_eq!(FormResponseId::generate().as_uuid().get_version_num(), 7);
}

#[test]
fn the_openapi_schema_is_a_documented_uuid_string() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<FormId as ToSchema>::name(), "FormId");
    assert_eq!(
        serde_json::to_string(&<FormId as PartialSchema>::schema()).unwrap(),
        r#"{"type":"string","format":"uuid","description":"Identifier of a form (the shareable entity respondents open)."}"#
    );
}

#[cfg(feature = "schema")]
#[test]
fn the_tool_schema_is_unchanged() {
    assert_eq!(
        serde_json::to_string(&schemars::schema_for!(FormId)).unwrap(),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"FormId","description":"Identifier of a form (the shareable entity respondents open).","type":"string","format":"uuid"}"#
    );
}
