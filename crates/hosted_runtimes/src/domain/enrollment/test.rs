use super::*;

#[test]
fn os_users_accept_linux_names_and_length_boundary() {
    for value in [
        "ada",
        "worker_1",
        "_worker",
        "agent-ada",
        "agent-",
        "agent--worker",
        "a234567890123456789012345678901",
    ] {
        assert!(PersonaOsUser::parse(value).is_ok(), "{value}");
        assert!(serde_json::from_value::<PersonaOsUser>(serde_json::json!(value)).is_ok());
    }
}

#[test]
fn os_users_reject_invalid_or_reserved_names() {
    for value in [
        "",
        "root",
        "macro",
        "macrod",
        "macrod-worker",
        "macrodaemon",
        "Ada",
        "1ada",
        "ada/../x",
        "ada.name",
        "ada\n",
        "ádá",
        "a2345678901234567890123456789012",
    ] {
        assert_eq!(
            PersonaOsUser::parse(value),
            Err(PersonaFieldError::OsUser),
            "{value:?}"
        );
        assert!(serde_json::from_value::<PersonaOsUser>(serde_json::json!(value)).is_err());
    }
}

#[test]
fn unit_names_accept_legacy_names_and_exact_length_boundary() {
    for value in [
        "ada",
        "agent-ada",
        "worker_1",
        "Agent@1",
        "Agent.service",
        ".",
        "-",
        "MACROD",
        "a234567890123456789012345678901234567890123456789012345678901234",
    ] {
        let unit = SystemdUnitName::parse(value).unwrap();
        assert_eq!(unit.as_str(), value);
        assert_eq!(unit.to_string(), value);
        assert_eq!(unit.into_inner(), value);
    }
}

#[test]
fn unit_names_reject_invalid_or_reserved_names() {
    for value in [
        "",
        "macrod",
        "macrod-enroll",
        "macrodaemon",
        "brain service",
        "../brain",
        "ada\n",
        "ádá",
        "a2345678901234567890123456789012345678901234567890123456789012345",
    ] {
        assert_eq!(
            SystemdUnitName::parse(value),
            Err(PersonaFieldError::UnitName),
            "{value:?}"
        );
        assert!(serde_json::from_value::<SystemdUnitName>(serde_json::json!(value)).is_err());
    }
}

#[test]
fn config_keys_accept_environment_names_and_sort_lexically() {
    for value in ["A", "_", "AGENT_ID", "worker_1", "ada", "aB123"] {
        let key = PersonaConfigKey::parse(value).unwrap();
        assert_eq!(key.as_str(), value);
        assert_eq!(key.to_string(), value);
        assert_eq!(key.into_inner(), value);
    }
    let keys = BTreeMap::from([
        (PersonaConfigKey::parse("Z").unwrap(), "last"),
        (PersonaConfigKey::parse("A").unwrap(), "first"),
    ]);
    assert_eq!(
        serde_json::to_string(&keys).unwrap(),
        r#"{"A":"first","Z":"last"}"#
    );
}

#[test]
fn config_keys_reject_invalid_environment_names() {
    for value in [
        "",
        "1AGENT",
        "AGENT-ID",
        "NOT VALID",
        "a.b",
        "a=b",
        "A\n",
        "Á",
    ] {
        assert_eq!(
            PersonaConfigKey::parse(value),
            Err(PersonaFieldError::ConfigKey),
            "{value:?}"
        );
        assert!(serde_json::from_value::<PersonaConfigKey>(serde_json::json!(value)).is_err());
    }
}

#[test]
fn persona_json_is_byte_identical_after_validated_read() {
    let json = r#"{"name":"Ada","os_user":"agent-ada","extra_service":{"unit_name":"agent-ada","exec":"/usr/local/bin/agent","env":{"RUST_LOG":"info","WORKER":"worker_1"}},"config":{"AGENT_ID":"agent-1","WORKSPACE":"/workspace"}}"#;
    let persona: Persona = serde_json::from_str(json).unwrap();
    assert_eq!(persona.os_user.as_str(), "agent-ada");
    assert_eq!(persona.extra_service.unit_name.as_str(), "agent-ada");
    assert_eq!(
        serde_json::to_string(&persona).unwrap().as_bytes(),
        json.as_bytes()
    );
}

#[test]
fn config_keys_support_borrowed_string_lookups() {
    let config = BTreeMap::from([
        (PersonaConfigKey::parse("REPO_URL").unwrap(), "repository"),
        (PersonaConfigKey::parse("AGENT_ID").unwrap(), "identity"),
        (PersonaConfigKey::parse("WORKSPACE").unwrap(), "workspace"),
    ]);
    assert_eq!(config.get("REPO_URL"), Some(&"repository"));
    assert_eq!(config.get("AGENT_ID"), Some(&"identity"));
    assert_eq!(config.get("WORKSPACE"), Some(&"workspace"));
    assert_eq!(config.get("MISSING"), None);
}

#[test]
fn persona_debug_redacts_config_and_service_environment_values() {
    let persona = Persona {
        name: "Worker".to_owned(),
        os_user: PersonaOsUser::parse("agent-worker").unwrap(),
        extra_service: PersonaService {
            unit_name: SystemdUnitName::parse("agent-worker").unwrap(),
            exec: "/bin/worker".to_owned(),
            env: BTreeMap::from([
                (
                    PersonaConfigKey::parse("MACRO_API_KEY").unwrap(),
                    "secret-api-value".to_owned(),
                ),
                (
                    PersonaConfigKey::parse("MODE").unwrap(),
                    "private-mode-value".to_owned(),
                ),
            ]),
        },
        config: BTreeMap::from([
            (
                PersonaConfigKey::parse("REPO_TOKEN").unwrap(),
                "secret-repository-value".to_owned(),
            ),
            (
                PersonaConfigKey::parse("REPO_URL").unwrap(),
                "private-repository-value".to_owned(),
            ),
        ]),
    };
    for output in [format!("{persona:?}"), format!("{persona:#?}")] {
        assert!(output.contains("REPO_TOKEN"));
        assert!(output.contains("REPO_URL"));
        assert!(output.contains("MACRO_API_KEY"));
        assert!(output.contains("MODE"));
        assert!(output.contains("**redacted**"));
        for value in persona
            .config
            .values()
            .chain(persona.extra_service.env.values())
        {
            assert!(!output.contains(value));
        }
    }
    for output in [
        format!("{:?}", persona.extra_service),
        format!("{:#?}", persona.extra_service),
    ] {
        assert!(output.contains("MACRO_API_KEY"));
        assert!(output.contains("MODE"));
        assert!(output.contains("**redacted**"));
        for value in persona.extra_service.env.values() {
            assert!(!output.contains(value));
        }
    }
}

#[test]
fn persona_values_reject_line_breaks_in_config_and_environment() {
    for value in ["first\nsecond", "first\rsecond"] {
        let mut json = serde_json::json!({
            "name": "Worker", "os_user": "worker", "extra_service": {"unit_name": "worker", "exec": "/bin/worker", "env": {}}, "config": {"KEY": value}
        });
        assert!(serde_json::from_value::<Persona>(json.clone()).is_err());
        json["config"] = serde_json::json!({});
        json["extra_service"]["env"] = serde_json::json!({"KEY": value});
        assert!(serde_json::from_value::<Persona>(json).is_err());
    }
}

#[test]
fn persisted_persona_rejects_bootstrap_keys_in_both_maps() {
    for name in [
        "MACRO_API_KEY",
        "MACRO_REPO_TOKEN",
        "ANTHROPIC_AUTH_TOKEN",
        "OTHER_TOKEN",
        "OTHER_KEY",
        "OTHER_SECRET",
    ] {
        let key = PersonaConfigKey::parse(name).unwrap();
        assert_eq!(
            key.validate_non_secret(),
            Err(PersonaFieldError::ReservedConfigKey)
        );
        for field in ["config", "env"] {
            let mut json = serde_json::json!({
                "name": "Worker", "os_user": "worker",
                "extra_service": {"unit_name": "worker", "exec": "/bin/worker", "env": {}},
                "config": {}
            });
            if field == "config" {
                json["config"][name] = serde_json::json!("fixture-bootstrap-value");
            } else {
                json["extra_service"]["env"][name] = serde_json::json!("fixture-bootstrap-value");
            }
            assert!(serde_json::from_value::<Persona>(json).is_err());
        }
    }
}

#[test]
fn bootstrap_suffix_rules_are_case_sensitive() {
    for name in ["other_token", "other_key", "other_secret", "REPO_URL"] {
        assert!(
            PersonaConfigKey::parse(name)
                .unwrap()
                .validate_non_secret()
                .is_ok()
        );
    }
}
