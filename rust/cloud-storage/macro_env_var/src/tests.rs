use crate::testing_harness::with_mock_env;
use std::sync::Arc;

use super::*;

env_var! {
    #[derive(Debug, Clone)]
    pub struct TestVar;
}

#[test]
fn test_macro_expands_correctly() {
    // This test checks that the macro expands without compilation errors
    // The actual environment variable won't exist, so we expect an error
    let result = TestVar::new();
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "Failed to find the TEST_VAR variable in environment")]
fn unwrap_does_panic() {
    TestVar::unwrap_new();
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
    // The environment variables won't exist, so we expect an error
    let result = Config::new();
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
    Config::unwrap_new();
}

// Tests for maybe_env_var! macro

maybe_env_var! {
    #[derive(Debug, Clone)]
    pub struct MaybeTestVar;
}

#[test]
fn maybe_env_var_returns_none_when_not_set() {
    let result = MaybeTestVar::new();
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
    let config = MaybeConfig::new();
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
