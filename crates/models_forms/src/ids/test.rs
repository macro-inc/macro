use super::*;

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
    assert_eq!(FormId::new().as_uuid().get_version_num(), 7);
    assert_eq!(FormSectionId::new().as_uuid().get_version_num(), 7);
    assert_eq!(FormQuestionId::new().as_uuid().get_version_num(), 7);
    assert_eq!(FormResponseId::new().as_uuid().get_version_num(), 7);
}
