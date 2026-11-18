use std::collections::BTreeMap;

use super::*;

#[test]
fn env_keys_are_upper_snake_case() {
    assert!(AgentEnvKey::new("MACRO_API_KEY").is_ok());
    assert!(AgentEnvKey::new("OVERRIDE_AUTH_SERVICE_URL2").is_ok());
    assert!(AgentEnvKey::new("macro_api_key").is_err());
    assert!(AgentEnvKey::new("1KEY").is_err());
    assert!(AgentEnvKey::new("KEY=VALUE").is_err());
    assert!(AgentEnvKey::new("").is_err());
}

#[test]
fn env_rejects_values_that_span_lines() {
    let mut values = BTreeMap::new();
    values.insert(
        AgentEnvKey::new("MACRO_API_KEY").unwrap(),
        "mak_abc\nMACRO_GATEWAY=https://evil.example".to_owned(),
    );
    assert!(AgentEnv::new(values).is_err());
}

#[test]
fn env_debug_shows_names_but_not_values() {
    let mut values = BTreeMap::new();
    values.insert(
        AgentEnvKey::new("MACRO_API_KEY").unwrap(),
        "mak_secret_value".to_owned(),
    );
    let env = AgentEnv::new(values).unwrap();
    let debug = format!("{env:?}");
    assert!(debug.contains("MACRO_API_KEY"));
    assert!(!debug.contains("mak_secret_value"));
}

#[test]
fn enrollment_round_trips_through_json() {
    let mut values = BTreeMap::new();
    values.insert(
        AgentEnvKey::new("MACRO_API_KEY").unwrap(),
        "mak_secret_value".to_owned(),
    );
    let enrollment = AgentEnrollment {
        agent_user_id: MacroUserIdStr::try_from("macro|ada-agent@macro.com".to_owned()).unwrap(),
        env: AgentEnv::new(values).unwrap(),
    };
    let json = serde_json::to_value(&enrollment).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "agent_user_id": "macro|ada-agent@macro.com",
            "env": {"MACRO_API_KEY": "mak_secret_value"},
        })
    );
    let back: AgentEnrollment = serde_json::from_value(json).unwrap();
    assert_eq!(back, enrollment);
}

#[test]
fn enrollment_rejects_invalid_names_from_json() {
    let json = serde_json::json!({
        "agent_user_id": "macro|ada-agent@macro.com",
        "env": {"PATH;rm": "x"},
    });
    assert!(serde_json::from_value::<AgentEnrollment>(json).is_err());
}

#[tokio::test]
async fn no_agent_enrollment_enrolls_without_an_agent() {
    let issued = NoAgentEnrollment
        .issue(
            ComputerId::new_from_uuid(uuid::Uuid::nil()),
            EnrollmentGeneration::new(1),
        )
        .await;
    assert_eq!(issued, Ok(None));
}
