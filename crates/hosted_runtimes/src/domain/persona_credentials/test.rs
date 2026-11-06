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

#[test]
fn enrollment_is_the_explicit_transport_and_debug_redacts_both_halves() {
    let enrollment: crate::domain::enrollment::Enrollment = serde_json::from_str(r#"{
        "computer_id":"00000000-0000-0000-0000-000000000001", "generation":1,
        "pairing_id":"00000000-0000-0000-0000-000000000002", "device_secret":"fixture-device-value",
        "name":"Fixture computer", "service_url_overrides":{}, "persona":null,
        "persona_enrollment":{"secrets":{"MACRO_API_KEY":"fixture-issued-value"},"env":{"OVERRIDE_APP_SERVICE_URL":"https://app.example.com"}}
    }"#).unwrap();
    for debug in [format!("{enrollment:?}"), format!("{enrollment:#?}")] {
        assert!(debug.contains("MACRO_API_KEY"));
        assert!(debug.contains("OVERRIDE_APP_SERVICE_URL"));
        for value in [
            "fixture-device-value",
            "fixture-issued-value",
            "https://app.example.com",
        ] {
            assert!(!debug.contains(value));
        }
    }
    let payload = serde_json::to_value(&enrollment).unwrap();
    assert_eq!(
        payload["persona_enrollment"]["secrets"]["MACRO_API_KEY"],
        "fixture-issued-value"
    );
    assert_eq!(
        payload["persona_enrollment"]["env"]["OVERRIDE_APP_SERVICE_URL"],
        "https://app.example.com"
    );
}
