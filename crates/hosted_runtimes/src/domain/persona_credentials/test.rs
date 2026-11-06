use super::*;

#[test]
fn credentials_redact_values_and_validate_lines() {
    let credentials = PersonaCredentials::new(BTreeMap::from([
        (
            PersonaConfigKey::parse("MACRO_API_KEY").unwrap(),
            "fixture-api-value".to_owned(),
        ),
        (
            PersonaConfigKey::parse("MACRO_REPO_TOKEN").unwrap(),
            "fixture-repo-value".to_owned(),
        ),
    ]))
    .unwrap();
    for debug in [format!("{credentials:?}"), format!("{credentials:#?}")] {
        assert!(debug.contains("MACRO_API_KEY"));
        assert!(debug.contains("MACRO_REPO_TOKEN"));
        assert!(!debug.contains("fixture-api-value"));
        assert!(!debug.contains("fixture-repo-value"));
    }
    assert!(matches!(
        PersonaCredentials::new(BTreeMap::from([(
            PersonaConfigKey::parse("MACRO_API_KEY").unwrap(),
            "first\nsecond".to_owned()
        ),])),
        Err(PersonaCredentialError::MultilineValue)
    ));
    assert!(matches!(
        PersonaEnv::new(BTreeMap::from([(
            PersonaConfigKey::parse("MACRO_API_KEY").unwrap(),
            "fixture-value".to_owned()
        ),])),
        Err(PersonaCredentialError::Field(
            PersonaFieldError::ReservedConfigKey
        ))
    ));
}
