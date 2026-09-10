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
fn port_offsets_are_unique() {
    let mut seen = std::collections::HashSet::new();
    for p in Port::all() {
        assert!(seen.insert(p.offset()), "duplicate offset for {p:?}");
        assert!(p.offset() < 1000, "offset must be < stride for {p:?}");
    }
}

#[test]
fn named_instance_ports_stay_below_the_linux_ephemeral_range() {
    let highest_base = WINDOW_START + (BUCKETS - 1) * STRIDE;
    let highest_offset = Port::all().map(Port::offset).max().unwrap() as u32;

    assert!(highest_base + highest_offset < 32_768);
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

/// New `Port` variants must be appended. Inserting mid-enum shifts named-instance
/// offsets for every later variant (Kafka, webhooks, agent harness, …).
#[test]
fn appended_port_offsets_stay_stable() {
    assert_eq!(Port::Kafka.offset(), 22);
    assert_eq!(Port::SdkWebhookSsh.offset(), 23);
    assert_eq!(Port::SdkWebhookHostReceiver.offset(), 24);
    assert_eq!(Port::AgentProxy.offset(), 25);
    assert_eq!(Port::AgentHarness.offset(), 26);
    assert_eq!(Port::AgentHarnessEgress.offset(), 27);
    assert_eq!(Port::ScheduledAction.offset(), 28);
    assert_eq!(Port::ScheduledAction.fixed(), 8099);
}
