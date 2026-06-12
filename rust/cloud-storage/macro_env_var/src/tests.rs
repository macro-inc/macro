use crate::testing_harness::with_mock_env;
use std::sync::Arc;

use super::*;

fn mock_no_env(_: &'static str) -> Result<String, std::env::VarError> {
    Err(std::env::VarError::NotPresent)
}

env_var! {
    #[derive(Debug, Clone)]
    pub struct TestVar;
}

#[test]
fn test_macro_expands_correctly() {
    // This test checks that the macro expands without compilation errors
    // The mocked environment variable won't exist, so we expect an error
    let result = with_mock_env(mock_no_env, TestVar::new);
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "Failed to find the TEST_VAR variable in environment")]
fn unwrap_does_panic() {
    with_mock_env(mock_no_env, TestVar::unwrap_new);
}

fn mock_test_var(k: &'static str) -> Result<String, std::env::VarError> {
    (k == "TEST_VAR")
        .then(|| "123456".to_string())
        .ok_or(std::env::VarError::NotPresent)
}

#[test]
fn it_should_read_value() {
    let v = with_mock_env(mock_test_var, TestVar::unwrap_new);
    assert_eq!(&*v, "123456");
}

#[test]
fn it_should_be_arced() {
    let v = with_mock_env(mock_test_var, TestVar::unwrap_new);
    let next = v.runtime_inner().unwrap().clone();
    let third = next.clone();
    assert_eq!(Arc::strong_count(&third), 3);
}

#[test]
fn required_env_var_deserializes_from_string() {
    let v = serde_json::from_str::<TestVar>(r#""from-serde""#).expect("env var deserializes");

    assert_eq!(&*v, "from-serde");
    assert!(v.runtime_inner().is_some());
}

#[test]
fn required_env_reads_from_app_secrets_json_when_key_exists() {
    let value = with_mock_env(
        |k| match k {
            "APP_SECRETS_JSON" => Ok(r#"{"FOO":"from-json"}"#.to_string()),
            "FOO" => Ok("from-env".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || read_env("FOO"),
    )
    .unwrap();

    assert_eq!(value, "from-json");
}

#[test]
fn required_env_falls_back_to_env_when_json_is_missing() {
    let value = with_mock_env(
        |k| match k {
            "FOO" => Ok("from-env".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || read_env("FOO"),
    )
    .unwrap();

    assert_eq!(value, "from-env");
}

#[test]
fn required_env_falls_back_to_env_when_json_is_invalid() {
    let value = with_mock_env(
        |k| match k {
            "APP_SECRETS_JSON" => Ok("not json".to_string()),
            "FOO" => Ok("from-env".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || read_env("FOO"),
    )
    .unwrap();

    assert_eq!(value, "from-env");
}

#[test]
fn required_env_falls_back_to_env_when_key_is_missing_from_json() {
    let value = with_mock_env(
        |k| match k {
            "APP_SECRETS_JSON" => Ok(r#"{"BAR":"from-json"}"#.to_string()),
            "FOO" => Ok("from-env".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || read_env("FOO"),
    )
    .unwrap();

    assert_eq!(value, "from-env");
}

#[test]
fn required_env_returns_error_when_neither_source_contains_key() {
    let result = with_mock_env(mock_no_env, || read_env("FOO"));

    assert!(result.is_err());
}

#[test]
fn required_env_converts_non_string_app_secrets_json_values() {
    let (count, enabled) = with_mock_env(
        |k| match k {
            "APP_SECRETS_JSON" => Ok(r#"{"COUNT":1,"ENABLED":true}"#.to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || (read_env("COUNT").unwrap(), read_env("ENABLED").unwrap()),
    );

    assert_eq!(count, "1");
    assert_eq!(enabled, "true");
}

env_var! {
    #[derive(Debug, Clone)]
    pub struct Config {
        #[derive(Debug, Clone)]
        pub DatabaseUrl,
        #[derive(Debug, Clone)]
        pub ApiKey,
    }
}

#[test]
fn test_struct_with_fields() {
    // This test verifies that structs with fields that implement EnvVar work correctly
    // The mocked environment variables won't exist, so we expect an error
    let result = with_mock_env(mock_no_env, Config::new);
    assert!(result.is_err());
}

fn mock_config_var(k: &'static str) -> Result<String, std::env::VarError> {
    match k {
        "DATABASE_URL" => Ok("postgres://localhost/test".to_string()),
        "API_KEY" => Ok("secret123".to_string()),
        _ => Err(std::env::VarError::NotPresent),
    }
}

#[test]
fn test_struct_with_fields_mock() {
    // Create individual env vars with mock
    let config = with_mock_env(mock_config_var, Config::unwrap_new);

    assert_eq!(&*config.database_url, "postgres://localhost/test");
    assert_eq!(&*config.api_key, "secret123");
}

#[test]
#[should_panic]
fn it_should_panic() {
    with_mock_env(mock_no_env, Config::unwrap_new);
}

env_vars! {
    #[derive(Debug, Clone)]
    pub struct BatchVarOne;
    pub struct BatchVarTwo;
    #[derive(Debug)]
    pub struct BatchVarThree;
}

fn mock_batch_vars(k: &'static str) -> Result<String, std::env::VarError> {
    match k {
        "BATCH_VAR_ONE" => Ok("one".to_string()),
        "BATCH_VAR_TWO" => Ok("two".to_string()),
        _ => Err(std::env::VarError::NotPresent),
    }
}

#[test]
fn env_vars_defines_multiple_readable_vars() {
    let (one, two) = with_mock_env(mock_batch_vars, || {
        (BatchVarOne::unwrap_new(), BatchVarTwo::unwrap_new())
    });

    assert_eq!(&*one, "one");
    assert_eq!(&*two, "two");
}

#[test]
fn env_vars_definitions_error_when_not_set() {
    let result = with_mock_env(mock_batch_vars, BatchVarThree::new);
    assert!(result.is_err());
}

// Tests for maybe_env_var! macro

maybe_env_var! {
    #[derive(Debug, Clone)]
    pub struct MaybeTestVar;
}

#[test]
fn maybe_env_var_returns_none_when_not_set() {
    let result = with_mock_env(mock_no_env, MaybeTestVar::new);
    assert!(result.is_none());
}

fn mock_maybe_test_var(k: &'static str) -> Result<String, std::env::VarError> {
    (k == "MAYBE_TEST_VAR")
        .then(|| "optional_value".to_string())
        .ok_or(std::env::VarError::NotPresent)
}

#[test]
fn maybe_env_var_returns_some_when_set() {
    let v = with_mock_env(mock_maybe_test_var, MaybeTestVar::new);
    assert!(v.is_some());
    assert_eq!(&*v.unwrap(), "optional_value");
}

#[test]
fn maybe_env_var_can_be_arced() {
    let v = with_mock_env(mock_maybe_test_var, || MaybeTestVar::new().unwrap());
    let next = v.runtime_inner().unwrap().clone();
    let third = next.clone();
    assert_eq!(Arc::strong_count(&third), 3);
}

#[test]
fn optional_env_var_deserializes_from_string() {
    let v = serde_json::from_str::<MaybeTestVar>(r#""optional-from-serde""#)
        .expect("optional env var deserializes");

    assert_eq!(&*v, "optional-from-serde");
    assert!(v.runtime_inner().is_some());
    assert_eq!(v.value(), Some("optional-from-serde"));
    assert!(v.is_set());
}

#[test]
fn optional_env_var_deserializes_null_as_unset() {
    let v = serde_json::from_str::<MaybeTestVar>("null").expect("null deserializes as unset");

    assert_eq!(v.value(), None);
    assert!(!v.is_set());
    assert!(v.runtime_inner().is_none());
    assert!(v.comptime_inner().is_none());
    assert!(v.as_arc().is_none());
}

#[test]
fn optional_env_var_new_unset_holds_no_value() {
    let v = MaybeTestVar::new_unset();

    assert_eq!(v.value(), None);
    assert!(!v.is_set());
}

#[test]
#[should_panic(expected = "dereferenced unset env var `MAYBE_TEST_VAR`")]
fn optional_env_var_deref_panics_when_unset() {
    let v = MaybeTestVar::new_unset();
    let _ = &*v;
}

#[test]
fn optional_env_returns_some_from_app_secrets_json_when_key_exists() {
    let value = with_mock_env(
        |k| match k {
            "APP_SECRETS_JSON" => Ok(r#"{"FOO":"from-json"}"#.to_string()),
            "FOO" => Ok("from-env".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || maybe_read_env("FOO"),
    );

    assert_eq!(value.as_deref(), Some("from-json"));
}

#[test]
fn optional_env_falls_back_to_env_when_json_is_missing() {
    let value = with_mock_env(
        |k| match k {
            "FOO" => Ok("from-env".to_string()),
            _ => Err(std::env::VarError::NotPresent),
        },
        || maybe_read_env("FOO"),
    );

    assert_eq!(value.as_deref(), Some("from-env"));
}

#[test]
fn optional_env_returns_none_when_neither_source_contains_key() {
    let value = with_mock_env(mock_no_env, || maybe_read_env("FOO"));

    assert_eq!(value, None);
}

maybe_env_var! {
    #[derive(Debug, Clone)]
    pub struct MaybeConfig {
        #[derive(Debug, Clone)]
        pub MaybeDbUrl,
        #[derive(Debug, Clone)]
        pub MaybeApiSecret,
    }
}

#[test]
fn maybe_struct_with_fields_all_none() {
    let config = with_mock_env(mock_no_env, MaybeConfig::new);
    assert!(config.maybe_db_url.is_none());
    assert!(config.maybe_api_secret.is_none());
}

fn mock_partial_config(k: &'static str) -> Result<String, std::env::VarError> {
    match k {
        "MAYBE_DB_URL" => Ok("postgres://localhost/test".to_string()),
        _ => Err(std::env::VarError::NotPresent),
    }
}

#[test]
fn maybe_struct_with_fields_partial() {
    let config = with_mock_env(mock_partial_config, MaybeConfig::new);
    assert!(config.maybe_db_url.is_some());
    assert_eq!(&*config.maybe_db_url.unwrap(), "postgres://localhost/test");
    assert!(config.maybe_api_secret.is_none());
}

fn mock_full_config(k: &'static str) -> Result<String, std::env::VarError> {
    match k {
        "MAYBE_DB_URL" => Ok("postgres://localhost/test".to_string()),
        "MAYBE_API_SECRET" => Ok("secret456".to_string()),
        _ => Err(std::env::VarError::NotPresent),
    }
}

#[test]
fn maybe_struct_with_fields_all_set() {
    let config = with_mock_env(mock_full_config, MaybeConfig::new);
    assert!(config.maybe_db_url.is_some());
    assert!(config.maybe_api_secret.is_some());
    assert_eq!(&*config.maybe_db_url.unwrap(), "postgres://localhost/test");
    assert_eq!(&*config.maybe_api_secret.unwrap(), "secret456");
}
