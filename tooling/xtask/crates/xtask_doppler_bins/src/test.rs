use super::*;

#[test]
fn bootstrap_defers_only_pending_services_and_activation_validates_them() {
    let graph = build_graph(true).unwrap();
    let root = graph.workspace().root();
    let mut services: ServicesConfig = serde_json::from_value(serde_json::json!({
        "services": {
            "contacts-service": {
                "bootstrap_pending": "Domain and secrets not configured",
                "deploy_binaries": ["contacts_service"]
            }
        }
    }))
    .unwrap();
    let changed = [
        "services/contacts_service/src/config.rs",
        "services/agent_harness_service/src/config.rs",
    ]
    .map(|path| root.join(path).into_std_path_buf())
    .into_iter()
    .collect();

    let bins = config_bins(&graph, &changed, &services).unwrap();
    assert!(!bins.contains("contacts_service_doppler_config"));
    assert!(bins.contains("agent_harness_service_doppler_config"));

    services
        .services
        .get_mut("contacts-service")
        .unwrap()
        .bootstrap_pending = None;
    let inventory_only = BTreeSet::from([root.join(SERVICES_CONFIG).into_std_path_buf()]);
    let bins = config_bins(&graph, &inventory_only, &services).unwrap();
    assert!(bins.contains("contacts_service_doppler_config"));
    assert!(bins.contains("agent_harness_service_doppler_config"));
    assert!(
        config_bins(&graph, &BTreeSet::new(), &services)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn nested_feature_configs_validate_the_shared_harness_project() {
    let graph = build_graph(true).unwrap();
    let root = graph.workspace().root();
    let services: ServicesConfig = serde_json::from_str("{\"services\":{}}").unwrap();
    for config in ["cognition", "preview", "scheduling"] {
        let changed = BTreeSet::from([root
            .join(format!(
                "services/agent_harness_service/src/{config}/config.rs"
            ))
            .into_std_path_buf()]);
        assert_eq!(
            config_bins(&graph, &changed, &services).unwrap(),
            BTreeSet::from(["agent_harness_service_doppler_config".to_owned()])
        );
    }
}
