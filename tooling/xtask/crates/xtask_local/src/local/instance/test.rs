use super::*;

#[test]
fn rejects_invalid_names() {
    for bad in ["", "Agent-A", "-foo", "a b", "x".repeat(41).as_str()] {
        assert!(
            InstanceName::parse(bad).is_err(),
            "expected '{bad}' to be rejected"
        );
    }
}

#[test]
fn accepts_valid_names() {
    for ok in ["agent-a", "feat_1", "a", "abc-123"] {
        assert!(
            InstanceName::parse(ok).is_ok(),
            "expected '{ok}' to be accepted"
        );
    }
}

#[test]
fn default_instance_uses_fixed_ports() {
    let inst = Instance::derive(None, None).unwrap();
    assert!(inst.is_default());
    assert_eq!(inst.project_name(), "macro");
    assert_eq!(inst.port(Port::Postgres), 5432);
    assert_eq!(inst.port(Port::Auth), 8080);
    assert_eq!(inst.port(Port::DocStorage), 8086);
    assert_eq!(inst.port(Port::SdkWebhookSsh), 8788);
    assert_eq!(inst.network_databases(), "databases");
    assert_eq!(inst.volume_postgres(), "macro_postgres_data");
}

#[test]
fn named_instance_is_isolated_and_deterministic() {
    let a1 = Instance::derive(Some("agent-a"), None).unwrap();
    let a2 = Instance::derive(Some("agent-a"), None).unwrap();
    assert_eq!(
        a1.port_base(),
        a2.port_base(),
        "derivation must be deterministic"
    );
    assert_eq!(a1.project_name(), "macro-agent-a");
    assert!(a1.port(Port::Postgres) >= 20_000);
    assert_eq!(
        a1.port(Port::SdkWebhookSsh),
        a1.port_base() + Port::SdkWebhookSsh.offset()
    );
    assert_eq!(a1.network_databases(), "databases-agent-a");
    assert_eq!(a1.volume_postgres(), "macro_postgres_data_agent-a");
}

#[test]
fn port_base_override_wins() {
    let inst = Instance::derive(Some("agent-a"), Some(12000)).unwrap();
    assert_eq!(inst.port_base(), 12000);
    assert_eq!(inst.port(Port::Postgres), 12000);
    assert_eq!(inst.port(Port::Auth), 12000 + Port::Auth.offset());
}

/// `DocCognition = 8085` is the default-instance discriminant, not a frozen
/// host port. A named `--port-base` stack publishes DCS at base + offset.
#[test]
fn doc_cognition_host_port_is_instance_derived() {
    let default = Instance::derive(None, None).unwrap();
    assert_eq!(default.port(Port::DocCognition), 8085);

    let named = Instance::derive(Some("macro-dev"), Some(31000)).unwrap();
    assert_eq!(
        named.port(Port::DocCognition),
        31000 + Port::DocCognition.offset()
    );
    assert_eq!(named.port(Port::DocCognition), 31014);
}

#[test]
fn networks_are_carved_from_the_block_in_order() {
    let instance = Instance::derive(Some("agent-a"), None)
        .unwrap()
        .with_allocation(30_400, Some(9));

    assert_eq!(
        instance.networks(),
        vec![
            (
                "databases-agent-a".to_string(),
                Some("10.254.9.0/26".to_string())
            ),
            (
                "auth-agent-a".to_string(),
                Some("10.254.9.64/26".to_string())
            ),
            (
                "macro-agent-a_services".to_string(),
                Some("10.254.9.128/26".to_string())
            ),
            (
                "macro-agent-a_auth-internal".to_string(),
                Some("10.254.9.192/26".to_string())
            ),
        ]
    );
}

#[test]
fn the_default_instance_creates_only_its_two_shared_networks() {
    let instance = Instance::derive(None, None).unwrap();
    let names: Vec<String> = instance
        .networks()
        .into_iter()
        .map(|(name, _)| name)
        .collect();

    assert_eq!(names, ["databases", "auth"]);
}
