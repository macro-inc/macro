use super::*;

fn request() -> ImportTable {
    ImportTable {
        request_id: macro_uuid::generate_uuid_v7(),
        name: " Contacts ".into(),
        columns: vec![" Name ".into(), "Postal code".into()],
        rows: vec![vec!["Ada".into(), "00123".into()]],
    }
}

#[test]
fn import_validation_preserves_text_and_fingerprints_normalized_headers() {
    let mut value = request();
    let first = validate_import(&mut value).unwrap();
    assert_eq!(value.name, "Contacts");
    assert_eq!(value.columns[0], "Name");
    assert_eq!(value.rows[0][1], "00123");
    assert_eq!(first, validate_import(&mut value).unwrap());
    value.rows[0][1] = "123".into();
    assert_ne!(first, validate_import(&mut value).unwrap());
}

#[test]
fn import_rejects_ambiguous_headers_and_non_rectangular_rows() {
    let mut value = request();
    value.columns = vec!["Name".into(), "name".into()];
    assert!(validate_import(&mut value).is_err());
    value.columns = vec!["Name".into()];
    assert!(validate_import(&mut value).is_err());
    value.rows.clear();
    assert!(validate_import(&mut value).is_ok());
}

#[test]
fn import_rejects_null_characters_before_creating_properties() {
    let mut value = request();
    value.rows[0][0] = "invalid\0text".into();
    assert!(validate_import(&mut value).is_err());
}
