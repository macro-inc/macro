use super::*;

#[test]
fn computer_names_trim_and_validate_character_count() {
    assert_eq!(
        ComputerName::try_new("  build box  ").unwrap().as_str(),
        "build box"
    );
    assert!(ComputerName::try_new("a").is_ok());
    assert!(
        ComputerName::try_new("a234567890123456789012345678901234567890123456789012345678901234")
            .is_ok()
    );
    assert!(
        ComputerName::try_new("é234567890123456789012345678901234567890123456789012345678901234")
            .is_ok()
    );
    for value in [
        "",
        "   ",
        "a2345678901234567890123456789012345678901234567890123456789012345",
    ] {
        assert!(ComputerName::try_new(value).is_err());
        assert!(serde_json::from_value::<ComputerName>(serde_json::json!(value)).is_err());
    }
}
