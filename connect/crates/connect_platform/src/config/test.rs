use super::*;

#[test]
fn loads_environment_values() {
    let config = ConfigLoader::from_values(HashMap::from([
        ("PORT".to_owned(), "9090".to_owned()),
        ("REQUIRED_VALUE".to_owned(), "ready".to_owned()),
    ]))
    .unwrap();

    assert_eq!(config.with_default("PORT", 8080_u16).unwrap(), 9090);
    assert_eq!(
        config.required::<String>("REQUIRED_VALUE").unwrap(),
        "ready"
    );
}

#[test]
fn app_secrets_json_takes_precedence_over_process_environment() {
    let config = ConfigLoader::from_values(HashMap::from([
        ("APP_SECRETS_JSON".to_owned(), r#"{"PORT":7070}"#.to_owned()),
        ("PORT".to_owned(), "9090".to_owned()),
        ("REQUIRED_VALUE".to_owned(), "outside".to_owned()),
    ]))
    .unwrap();

    assert_eq!(config.with_default("PORT", 8080_u16).unwrap(), 7070);
    assert!(matches!(
        config.required::<String>("REQUIRED_VALUE"),
        Err(ConfigError::Missing("REQUIRED_VALUE"))
    ));
}

#[test]
fn missing_required_value_names_its_variable() {
    let config = ConfigLoader::from_values(HashMap::new()).unwrap();
    assert_eq!(
        config
            .required::<String>("CLIENT_ID")
            .unwrap_err()
            .to_string(),
        "missing required config value: CLIENT_ID"
    );
}
