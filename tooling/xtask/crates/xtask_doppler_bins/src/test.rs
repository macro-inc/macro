use super::*;

#[test]
fn bootstrap_defers_only_pending_services_and_activation_validates_them() {
    let graph = build_graph(true).unwrap();
    let root = graph.workspace().root();
    let mut services: ServicesConfig = serde_json::from_value(serde_json::json!({
        "services": {
            "preview-gateway": {
                "bootstrap_pending": "Domain and secrets not configured",
                "deploy_binaries": ["preview_gateway"]
            }
        }
    }))
    .unwrap();
    let changed = [
        "services/preview_gateway/src/config.rs",
        "services/agent_harness_service/src/config.rs",
    ]
    .map(|path| root.join(path).into_std_path_buf())
    .into_iter()
    .collect();

    let bins = config_bins(&graph, &changed, &services).unwrap();
    assert!(!bins.contains("preview_gateway_doppler_config"));
    assert!(bins.contains("agent_harness_service_doppler_config"));

    services
        .services
        .get_mut("preview-gateway")
        .unwrap()
        .bootstrap_pending = None;
    let inventory_only = BTreeSet::from([root.join(SERVICES_CONFIG).into_std_path_buf()]);
    let bins = config_bins(&graph, &inventory_only, &services).unwrap();
    assert!(bins.contains("preview_gateway_doppler_config"));
    assert!(bins.contains("agent_harness_service_doppler_config"));
    assert!(
        config_bins(&graph, &BTreeSet::new(), &services)
            .unwrap()
            .is_empty()
    );
}
