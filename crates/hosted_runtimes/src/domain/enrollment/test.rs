use super::*;

#[test]
fn os_users_accept_prefixed_names_and_exact_length_boundary() {
    for value in [
        "agent-ada",
        "agent-worker_1",
        "agent-0",
        "agent-a_b-c",
        "agent-a234567890123456789012345",
    ] {
        let user = PersonaOsUser::parse(value).unwrap();
        assert_eq!(user.as_str(), value);
        assert_eq!(user.to_string(), value);
        assert_eq!(user.into_inner(), value);
    }
}

#[test]
fn os_users_reject_invalid_or_reserved_names() {
    for value in [
        "",
        "ada",
        "worker_1",
        "agent",
        "agent-",
        "agent-_worker",
        "agent--worker",
        "agent-Ada",
        "agent-ada/../x",
        "agent-ada.name",
        "agent-ada\n",
        "agent-ádá",
        "agent-a2345678901234567890123456",
        "root",
        "macro",
        "macrod",
        "macrod-agent",
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
fn legacy_persona_users_are_rejected_on_parse_and_json_read() {
    for value in ["ada", "worker_1", "macro-agent"] {
        let error = PersonaOsUser::parse(value).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("persona users must start with `agent-`")
        );
        let json = serde_json::json!({
            "name": "Worker",
            "os_user": value,
            "extra_service": {"unit_name": "worker_1", "exec": "/bin/worker", "env": {}},
            "config": {}
        });
        let error = serde_json::from_value::<Persona>(json).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("persona users must start with `agent-`")
        );
    }
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
