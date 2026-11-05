use super::*;

#[test]
fn enabled_local_fleet_requires_complete_overrides() {
    for overrides in [
        BTreeMap::new(),
        BTreeMap::from([(
            "OVERRIDE_API_GATEWAY_URL".to_string(),
            "http://proxy:8112".to_string(),
        )]),
    ] {
        assert!(
            ComputerUrls::from_defaults(
                Environment::Local,
                true,
                &overrides,
                ComputerUrls {
                    gateway: "http://localhost:8090".into(),
                    egress: "http://localhost:8102".into(),
                    git: "http://localhost:8111".into(),
                }
            )
            .is_err()
        );
    }
}

#[test]
fn computer_overrides_replace_host_only_and_in_network_defaults() {
    let urls = ComputerUrls::resolve(
        &BTreeMap::from([
            (
                "OVERRIDE_API_GATEWAY_URL".to_string(),
                "http://10.210.0.1:22411".to_string(),
            ),
            (
                "OVERRIDE_AGENT_HARNESS_EGRESS_URL".to_string(),
                "http://10.210.0.1:22412".to_string(),
            ),
            (
                "OVERRIDE_AGENT_GIT_SERVICE_URL".to_string(),
                "http://10.210.0.1:22413".to_string(),
            ),
        ]),
        ComputerUrls {
            gateway: "https://localhost:22410".to_string(),
            egress: "http://agent-harness-service:8102".to_string(),
            git: "http://agent-git-service:8080".to_string(),
        },
    )
    .unwrap();
    assert_eq!(urls.gateway, "http://10.210.0.1:22411");
    assert_eq!(urls.egress, "http://10.210.0.1:22412");
    assert_eq!(urls.git, "http://10.210.0.1:22413");
}

#[test]
fn loopback_and_unspecified_addresses_cannot_be_advertised_to_a_computer() {
    for gateway in [
        "http://localhost:8090",
        "https://preview.localhost:8090",
        "http://127.0.0.1:8090",
        "http://[::1]:8090",
        "http://0.0.0.0:8090",
    ] {
        assert!(
            ComputerUrls::resolve(
                &BTreeMap::new(),
                ComputerUrls {
                    gateway: gateway.to_string(),
                    egress: "https://gateway.example.com/agent-harness-egress".to_string(),
                    git: "https://gateway.example.com/agent-git".to_string()
                }
            )
            .is_err()
        );
    }
}
