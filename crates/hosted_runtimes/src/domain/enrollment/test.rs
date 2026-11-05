use super::*;

#[test]
fn os_users_accept_legacy_names_and_exact_length_boundary() {
    for value in [
        "ada",
        "agent-ada",
        "worker_1",
        "_",
        "macro-agent",
        "a234567890123456789012345678901",
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
    let json = r#"{"name":"Ada","os_user":"ada","extra_service":{"unit_name":"agent-ada","exec":"/usr/local/bin/agent","env":{"RUST_LOG":"info","WORKER":"worker_1"}},"config":{"AGENT_ID":"agent-1","WORKSPACE":"/workspace"}}"#;
    let persona: Persona = serde_json::from_str(json).unwrap();
    assert_eq!(persona.os_user.as_str(), "ada");
    assert_eq!(persona.extra_service.unit_name.as_str(), "agent-ada");
    assert_eq!(
        serde_json::to_string(&persona).unwrap().as_bytes(),
        json.as_bytes()
    );
}

#[test]
fn legacy_persona_names_read_without_migration() {
    let persona: Persona = serde_json::from_str(r#"{"name":"Worker","os_user":"worker_1","extra_service":{"unit_name":"worker_1","exec":"/bin/worker","env":{}},"config":{}}"#).unwrap();
    assert_eq!(persona.os_user.as_str(), "worker_1");
}
